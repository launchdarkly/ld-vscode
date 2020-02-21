import { ConfigurationChangeEvent, commands, window } from 'vscode';
import { LDFeatureStore, LDStreamProcessor } from 'launchdarkly-node-server-sdk';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import StreamProcessor = require('launchdarkly-node-server-sdk/streaming');
import Requestor = require('launchdarkly-node-server-sdk/requestor');
import { debounce } from 'lodash';

import { Flag, FlagConfiguration, FlagWithConfiguration } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';

const PACKAGE_JSON = require('../package.json');
const DATA_KIND = { namespace: 'features' };

export class FlagStore {
	private readonly config: Configuration;
	private readonly store: LDFeatureStore;
	private readonly flagMetadata: { [key: string]: Flag } = {};

	private readonly api: LaunchDarklyAPI;
	private readonly streamingConfigOptions = ['accessToken', 'baseUri', 'streamUri', 'project', 'env'];
	private updateProcessor: LDStreamProcessor;

	constructor(config: Configuration, api: LaunchDarklyAPI) {
		this.config = config;
		this.api = api;
		this.store = InMemoryFeatureStore();
		this.start();
	}

	async reload(e?: ConfigurationChangeEvent) {
		if (e && this.streamingConfigOptions.every(option => !e.affectsConfiguration(`launchdarkly.${option}`))) {
			return;
		}
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(async () => {
		await this.stop();
		const err = await this.start();
		if (err) {
			window.showErrorMessage(`[LaunchDarkly] ${err}`);
		}
	}, 200);

	async start() {
		if (!['accessToken', 'baseUri', 'streamUri', 'project', 'env'].every(o => !!this.config[o])) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return;
		}

		const sdkKey = await this.getLatestSDKKey();
		if (!sdkKey) {
			return;
		}

		const ldConfig = this.ldConfig();
		this.updateProcessor = StreamProcessor(sdkKey, ldConfig, Requestor(sdkKey, ldConfig));
		return new Promise((resolve, reject) => {
			this.updateProcessor.start(err => {
				if (err) {
					let errMsg: string;
					if (err.message) {
						errMsg = `Error retrieving feature flags: ${err.message}.`;
					} else {
						console.error(err);
						errMsg = `Unexpected error retrieving flags.`;
					}
					reject(errMsg);
					return;
				}
				resolve();
				process.nextTick(function() {});
			});
		});
	}

	stop(): Promise<void> {
		return new Promise(resolve => {
			this.updateProcessor && this.updateProcessor.stop();
			this.store.init({ features: [] }, resolve);
		});
	}

	private async getLatestSDKKey() {
		try {
			const env = await this.api.getEnvironment(this.config.project, this.config.env);
			return env.apiKey;
		} catch (err) {
			if (err.statusCode === 404) {
				window
					.showErrorMessage(
						'Your configured LaunchDarkly environment does not exist. Please reconfigure the extension.',
						'Configure',
					)
					.then(item => item && commands.executeCommand('extension.configureLaunchDarkly'));
				return;
			}
			console.error(`Failed to retrieve LaunchDarkly SDK Key: ${err}`);
			return;
		}
	}

	private ldConfig(): any {
		return {
			timeout: 5,
			baseUri: this.config.baseUri,
			streamUri: this.config.streamUri,
			featureStore: this.store,
			logger: {
				debug: console.log,
				warn: console.warn,
				error: console.error,
			},
			userAgent: 'VSCodeExtension/' + PACKAGE_JSON.version,
		};
	}

	getFeatureFlag(key: string): Promise<FlagWithConfiguration | null> {
		let flag = this.flagMetadata[key];
		return new Promise((resolve, reject) => {
			this.store.get(DATA_KIND, key, async (res: FlagConfiguration) => {
				if (!res) {
					resolve(null);
				}
				if (!flag || flag.environments[this.config.env].version < res.version) {
					try {
						flag = await this.api.getFeatureFlag(this.config.project, key, this.config.env);
						this.flagMetadata[key] = flag;
						resolve({ flag, config: res });
					} catch (e) {
						console.error(`Could not retrieve feature flag metadata for ${key}: ${e}`);
						reject(e);
					}
				}
			});
		});
	}

	allFlags(): Promise<FlagConfiguration[]> {
		return new Promise(resolve => {
			this.store.all(DATA_KIND, resolve);
		});
	}
}
