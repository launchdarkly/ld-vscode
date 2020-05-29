import { ConfigurationChangeEvent, commands, window } from 'vscode';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import LaunchDarkly = require('launchdarkly-node-server-sdk');

import { debounce } from 'lodash';

import { FeatureFlag, FlagConfiguration, FlagWithConfiguration } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { resolveCname } from 'dns';

const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (flag: FeatureFlag) => void;
type LDClientResolve = (LDClient: LaunchDarkly.LDClient) => void;
type LDClientReject = () => void;

export class FlagStore {
	private readonly config: Configuration;
	private readonly store: LaunchDarkly.LDFeatureStore;
	public flagMetadata: Object
	private readonly api: LaunchDarklyAPI
	private resolveLDClient: LDClientResolve;
	private rejectLDClient: LDClientReject;
	private ldClient: Promise<LaunchDarkly.LDClient> = new Promise((resolve, reject) => {
		this.resolveLDClient = resolve;
		this.rejectLDClient = reject;
	});

	constructor(config: Configuration, api: LaunchDarklyAPI, flagMetadata: Object) {
		this.config = config;
		this.api = api;
		this.store = InMemoryFeatureStore();
		this.start();
		this.flagMetadata = flagMetadata
	}

	async reload(e?: ConfigurationChangeEvent) {
		if (e && this.config.streamingConfigReloadCheck(e)) {
			return;
		}
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				await this.stop();
				await this.start();
			} catch (err) {
				window.showErrorMessage(`[LaunchDarkly] ${err}`);
			}
		},
		200,
		{ leading: false, trailing: true },
	);

	async start() {
		if (!this.config.streamingConfigStartCheck()) {
			return;
		}
		try {
			const sdkKey = await this.getLatestSDKKey();
			const ldConfig = this.ldConfig();
			const ldClient = await LaunchDarkly.init(sdkKey, ldConfig).waitForInitialization();
			this.resolveLDClient(ldClient);
		} catch (err) {
			this.rejectLDClient();
			console.error(err);
		}
	}

	async on(event: string, cb: FlagUpdateCallback) {
		try {
			const ldClient = await this.ldClient;
			await ldClient.on(event, cb);
		} catch (err) {
			// do nothing, ldclient does not exist
		}
	}

	async removeAllListeners() {
		try {
			const ldClient = await this.ldClient;
			await ldClient.removeAllListeners('update');
		} catch (err) {
			// do nothing, ldclient does not exist
		}
	}

	async stop() {
		try {
			// Optimistically reject, if already resolved this has no effect
			this.rejectLDClient();
			const ldClient = await this.ldClient;
			ldClient.close();
		} catch {
			// ldClient was rejected, nothing to do
		}
		this.ldClient = new Promise((resolve, reject) => {
			this.resolveLDClient = resolve;
			this.rejectLDClient = reject;
		});
	}

	public async clientInitialized() {
		const ldClient = await this.ldClient
		const initialized = await ldClient.initialized

		return initialized
	}

	public async featureStore(): Promise<boolean> {
		await this.start()
		if (this.flagMetadata !== undefined && Object.keys(this.flagMetadata).length > 0) {
			console.log("wut")
			return true
		}
		// await new Promise(resolve => {
		// 	setTimeout(resolve, 5000)
		// })
		console.log(this.flagMetadata["chatbox"])
		console.log("return true")
		return true
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
			}
			throw err;
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
