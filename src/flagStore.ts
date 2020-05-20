import { ConfigurationChangeEvent, commands, window } from 'vscode';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import LaunchDarkly = require('launchdarkly-node-server-sdk');

import { debounce } from 'lodash';

import { FeatureFlag, FlagConfiguration, FlagWithConfiguration } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';

const PACKAGE_JSON = require('../package.json');
const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (flag: FeatureFlag) => void;

export class FlagStore {
	private readonly config: Configuration;
	private readonly store: LaunchDarkly.LDFeatureStore;
	private readonly flagMetadata: { [key: string]: FeatureFlag } = {};

	private readonly api: LaunchDarklyAPI;
	private readonly streamingConfigOptions = ['accessToken', 'baseUri', 'streamUri', 'project', 'env'];
	public ldClient: LaunchDarkly.LDClient;

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
		try {
			await this.stop();
			await this.start();
		} catch (err) {
			window.showErrorMessage(`[LaunchDarkly] ${err}`);
		}
	}, 200, { leading: false, trailing: true });

	async start() {
		if (!['accessToken', 'baseUri', 'streamUri', 'project', 'env'].every(o => !!this.config[o])) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return;
		}

		const sdkKey = await this.getLatestSDKKey();
		const ldConfig = this.ldConfig();
		this.ldClient = LaunchDarkly.init(sdkKey, ldConfig);
	}

	async on(event: string, cb: FlagUpdateCallback) {
		if (!this.ldClient) {
			await require('util').promisify(setTimeout)(5000);
		}
		try {
			await this.ldClient.waitForInitialization();
			const sdkKey = await this.getLatestSDKKey();
			await this.ldClient.on(event, cb);
		} catch (err) {
			console.error(err)
		}
	}

	async removeAll() {
		await this.ldClient.removeAllListeners('update')
	}

	stop(): Promise<void> {
		return new Promise(resolve => {
			this.ldClient && this.ldClient.close();
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
		};
	}

	getFeatureFlag(key: string): Promise<FlagWithConfiguration | null> {
		let flag = this.flagMetadata[key];
		return new Promise((resolve, reject) => {
			this.store.get(DATA_KIND, key, async (res: FlagConfiguration) => {
				if (!res) {
					resolve(null);
					return;
				}

				if (!flag) {
					try {
						flag = await this.api.getFeatureFlag(this.config.project, key, this.config.env);
						this.flagMetadata[key] = flag;
					} catch (e) {
						console.error(`Could not retrieve feature flag metadata for ${key}: ${e}`);
						reject(e);
						return;
					}
				}

				resolve({ flag, config: res });
			});
		});
	}

	allFlags(): Promise<FlagConfiguration[]> {
		return new Promise(resolve => {
			this.store.all(DATA_KIND, resolve);
		});
	}
}
