import { ConfigurationChangeEvent, commands, EventEmitter, window } from 'vscode';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import LaunchDarkly = require('launchdarkly-node-server-sdk');

import { debounce, Dictionary, keyBy } from 'lodash';

import { FeatureFlag, FlagConfiguration, FlagWithConfiguration } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';

const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (Object: string) => void;
type LDClientResolve = (LDClient: LaunchDarkly.LDClient) => void;
type LDClientReject = () => void;

export class FlagStore {
	private readonly config: Configuration;
	private readonly store: LaunchDarkly.LDFeatureStore;
	flagMetadata: Dictionary<FeatureFlag>
	public storeUpdates: EventEmitter<boolean | null> = new EventEmitter();

	private readonly api: LaunchDarklyAPI;

	private resolveLDClient: LDClientResolve;
	private rejectLDClient: LDClientReject;
	private ldClient: Promise<LaunchDarkly.LDClient> = new Promise((resolve, reject) => {
		this.resolveLDClient = resolve;
		this.rejectLDClient = reject;
	});

	constructor(config: Configuration, api: LaunchDarklyAPI, flagMetadata: Dictionary<FeatureFlag> ) {
		this.config = config;
		this.api = api;
		this.store = InMemoryFeatureStore();
		this.start();
		this.flagMetadata = flagMetadata
	}

	async reload(e?: ConfigurationChangeEvent): Promise<void> {
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

	async start(): Promise<void> {
		if (!this.config.streamingConfigStartCheck()) {
			return;
		}
		try {
			const sdkKey = await this.getLatestSDKKey();
			const ldConfig = this.ldConfig();
			const ldClient = await LaunchDarkly.init(sdkKey, ldConfig).waitForInitialization();
			this.resolveLDClient(ldClient);
			if (this.config.refreshRate) {
				if (this.config.validateRefreshInterval(this.config.refreshRate)) {
					this.startGlobalFlagUpdateTask(this.config.refreshRate);
				} else {
					window.showErrorMessage(
						`Invalid Refresh time (in Minutes): '${this.config.refreshRate}'. 0 is off, up to 1440 for one day.`,
					);
				}
			}
		} catch (err) {
			this.rejectLDClient();
			console.error(err);
		}
	}

	private async startGlobalFlagUpdateTask(interval: number) {
		const ms = interval * 60 * 1000;
		setInterval(() => {
			this.updateFlags();
		}, ms);
	}

	async updateFlags(): Promise<void> {
		await this.debounceUpdate();
	}

	async on(event: string, cb: FlagUpdateCallback): Promise<void> {
		try {
			const ldClient = await this.ldClient;
			await ldClient.on(event, cb);
		} catch (err) {
			// do nothing, ldclient does not exist
		}
	}

	async removeAllListeners(): Promise<void> {
		try {
			const ldClient = await this.ldClient;
			await ldClient.removeAllListeners('update');
		} catch (err) {
			// do nothing, ldclient does not exist
		}
	}

	async stop(): Promise<void> {
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

	private async getLatestSDKKey(): Promise<string> {
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

	private ldConfig(): Record<string, number | string | LaunchDarkly.LDFeatureStore> {
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
				//console.log(flag)
				console.log(res)
				resolve({ flag, config: res });
			});
		});
	}

	allFlags(): Promise<FlagConfiguration[]> {
		return new Promise(resolve => {
			this.store.all(DATA_KIND, resolve);
		});
	}

	allFlagsConfig(): Promise<FlagConfiguration[]> {
		return new Promise(resolve => {
			this.store.all(DATA_KIND, resolve);
		});
	}

	private readonly debounceUpdate = debounce(
		async () => {
			try {
				const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
				this.flagMetadata = keyBy(flags, 'key');
				this.storeUpdates.fire(true);
			} catch (err) {
				let errMsg;
				if (err.statusCode == 404) {
					errMsg = `Project does not exist`;
				} else if (err.statusCode == 401) {
					errMsg = `Unauthorized`;
				}
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
		},
		5000,
		{ leading: true, trailing: true },
	);
}
