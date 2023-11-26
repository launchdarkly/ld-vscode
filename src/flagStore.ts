import { ConfigurationChangeEvent, commands, EventEmitter, window } from 'vscode';
import InMemoryFeatureStore from '@launchdarkly/js-server-sdk-common/dist/store/InMemoryFeatureStore';
import LaunchDarkly, { LDFeatureStoreKindData, basicLogger, init } from '@launchdarkly/node-server-sdk';
import { LDClient } from '@launchdarkly/node-server-sdk/dist/src/api';
import { LDOptions } from '@launchdarkly/node-server-sdk/dist/src/index';
import { debounce, Dictionary, keyBy } from 'lodash';

import { FeatureFlag, FlagConfiguration, FlagWithConfiguration } from './models';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';

const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (flag: string) => void;
type LDClientResolve = (LDClient: LDClient) => void;
type LDClientReject = () => void;

export class FlagStore {
	private readonly config: LDExtensionConfiguration;
	private readonly store: LaunchDarkly.LDFeatureStore;
	private flagMetadata: Dictionary<FeatureFlag>;
	public readonly storeUpdates: EventEmitter<boolean | null> = new EventEmitter();
	// We fire a storeReady event because this will always exist compared to 'ready' listener on LDClient
	// which may be reinitialized
	public readonly storeReady: EventEmitter<boolean | null> = new EventEmitter();
	//private readonly api: LaunchDarklyAPI;
	private resolveLDClient: LDClientResolve;
	private rejectLDClient: LDClientReject;
	private ldClient: Promise<LDClient> = new Promise((resolve, reject) => {
		this.resolveLDClient = resolve;
		this.rejectLDClient = reject;
	});
	private offlineTimer: NodeJS.Timer;
	private offlineTimerSet = false;

	constructor(config: LDExtensionConfiguration) {
		this.config = config;
		//this.api = api;
		this.store = new InMemoryFeatureStore();
		this.reload();
	}

	async reload(e?: ConfigurationChangeEvent): Promise<void> {
		if (e && this.config.getConfig().streamingConfigReloadCheck(e)) {
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
		if (!this.config.getConfig().streamingConfigStartCheck()) {
			return;
		}

		try {
			const flags = await this.config
				.getApi()
				.getFeatureFlags(this.config.getConfig().project, this.config.getConfig().env);
			this.flagMetadata = keyBy(flags, 'key');
		} catch (err) {
			console.log(`Error getting flags ${err}`);
		}
		try {
			const sdkKey = await this.getLatestSDKKey();
			if (sdkKey === '' || !sdkKey.startsWith('sdk-')) {
				throw new Error('SDK Key was empty was empty. Please reconfigure the plugin.');
			}
			const intldConfig = this.ldConfig();
			const ldClient = (await init(sdkKey, intldConfig).waitForInitialization()) as LDClient; // Typescript was picking up the LDClient from JSCommon
			this.resolveLDClient(ldClient);
			this.storeReady.fire(true);
			if (this.config.getConfig().refreshRate) {
				if (this.config.getConfig().validateRefreshInterval(this.config.getConfig().refreshRate)) {
					this.startGlobalFlagUpdateTask(this.config.getConfig().refreshRate);
				} else {
					window.showErrorMessage(
						`Invalid Refresh time (in Minutes): '${
							this.config.getConfig().refreshRate
						}'. 0 is off, up to 1440 for one day.`,
					);
				}
			}
			this.storeUpdates.fire(true);
			this.setFlagListeners();
			this.setLDClientBackgroundCheck();
		} catch (err) {
			window
				.showErrorMessage('[LaunchDarkly] Failed to setup LaunchDarkly client', 'Configure LaunchDarkly Extension')
				.then((selection) => {
					if (selection === 'Configure LaunchDarkly Extension')
						commands.executeCommand('extension.configureLaunchDarkly');
				});
			this.rejectLDClient();
			console.error(`Failed to setup client: ${err}`);
		}
	}

	private setFlagListeners() {
		this.on('update', async (keys: string) => {
			const flagKeys = Object.values(keys);
			flagKeys.map((key) => {
				this.store.get(DATA_KIND, key, async (res: FlagConfiguration) => {
					if (!res) {
						return;
					}
					if (this.flagMetadata[key]?.variations.length !== res.variations.length) {
						this.flagMetadata[key] = await this.config
							.getApi()
							.getFeatureFlag(this.config.getConfig().project, key, this.config.getConfig().env);
						this.storeUpdates.fire(true);
					}
				});
			});
		});
		this.on('error', async (err: string) => {
			console.log(err);
			this.debouncedReload();
		});
	}

	private setLDClientBackgroundCheck() {
		return window.onDidChangeWindowState(async (e) => {
			const ldClient = await this.ldClient;
			if (e.focused) {
				if (this.offlineTimerSet) {
					await this.reload();
					this.offlineTimerSet = false;
				}
				if (typeof this.offlineTimer !== 'undefined') {
					clearTimeout(this.offlineTimer);
					delete this.offlineTimer;
					this.offlineTimerSet = false;
				}
			} else {
				if (typeof this.offlineTimer === 'undefined') {
					this.offlineTimer = setTimeout(async () => {
						this.offlineTimerSet = true;
						await ldClient.close();
					}, 300000);
				}
			}
		});
	}

	private async startGlobalFlagUpdateTask(interval: number) {
		// Add jitter, if all instances are reopened as part of reboot they do not query at same time.
		const ms = interval * 60 * 1000 + Math.floor(Math.random() * 120) + 1 * 1000;
		setInterval(() => {
			this.updateFlags();
		}, ms);
	}

	private readonly debounceUpdate = debounce(
		async () => {
			try {
				const flags = await this.config
					.getApi()
					.getFeatureFlags(this.config.getConfig().project, this.config.getConfig().env);
				this.flagMetadata = keyBy(flags, 'key');
				this.storeUpdates.fire(true);
			} catch (err) {
				let errMsg;
				if (err.statusCode == 404) {
					errMsg = `Project does not exist`;
				} else if (err.statusCode == 401) {
					errMsg = `Unauthorized`;
				} else if (err.code == 'ENOTFOUND' || err.code == 'ECONNRESET') {
					// We know the domain should exist.
					console.log(err); // Still want to log that this is happening
					return;
				} else {
					errMsg = err.message;
					console.log(`${err}`);
					return;
				}
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
		},
		5000,
		{ trailing: true },
	);

	private async getLatestSDKKey(): Promise<string> {
		try {
			const env = await this.config
				.getApi()
				.getEnvironment(this.config.getConfig().project, this.config.getConfig().env);
			return env.apiKey;
		} catch (err) {
			if (err.statusCode === 404) {
				window
					.showErrorMessage(
						'Your configured LaunchDarkly environment does not exist. Please reconfigure the extension.',
						'Configure',
					)
					.then((item) => item && commands.executeCommand('extension.configureLaunchDarkly'));
			}
			throw err;
		}
	}

	private ldConfig(): LDOptions {
		// Cannot replace in the config, so updating at call site.
		const streamUri = this.config.getConfig().baseUri.replace('app', 'stream');
		const logger: LaunchDarkly.LDLogger = basicLogger({
			level: 'error',
		});
		const options: LDOptions = {
			timeout: 5,
			baseUri: this.config.getConfig().baseUri,
			streamUri: streamUri,
			sendEvents: false,
			featureStore: this.store,
			streamInitialReconnectDelay: Math.floor(Math.random() * 5) + 1,
			logger: logger,
		};
		return options;
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
			await setTimeout(async () => {
				const ldClient = await this.ldClient;
				await ldClient.removeAllListeners('update');
			}, 500);
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
			delete this.ldClient;
			this.removeAllListeners();
		} catch {
			// ldClient was rejected, nothing to do
		}
		this.ldClient = new Promise((resolve, reject) => {
			this.resolveLDClient = resolve;
			this.rejectLDClient = reject;
		});
	}

	async getFeatureFlag(key: string): Promise<FlagWithConfiguration | null> {
		if (this.flagMetadata === undefined) {
			await this.debounceUpdate();
		}

		let flag = this.flagMetadata[key];
		return new Promise((resolve, reject) => {
			this.store.get(DATA_KIND, key, async (res: FlagConfiguration) => {
				if (!res) {
					resolve(null);
					return;
				}

				if (!flag) {
					try {
						flag = await this.config
							.getApi()
							.getFeatureFlag(this.config.getConfig().project, key, this.config.getConfig().env);
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

	async forceFeatureFlagUpdate(flagKey: string): Promise<void> {
		this.flagMetadata[flagKey] = await this.config
			.getApi()
			.getFeatureFlag(this.config.getConfig().project, flagKey, this.config.getConfig().env);
		this.storeUpdates.fire(true);
	}

	allFlags(): Promise<FlagConfiguration[] | LDFeatureStoreKindData> {
		return new Promise((resolve) => {
			this.store.all(DATA_KIND, resolve);
		});
	}

	async getFlagConfig(flag: string): Promise<FlagConfiguration> {
		return new Promise((resolve) => {
			this.store.get(DATA_KIND, flag, async (res: FlagConfiguration) => {
				resolve(res);
			});
		});
	}

	async getFlagMetadata(flag: string): Promise<FeatureFlag> {
		await this.ldClient;
		if (this.flagMetadata === undefined && this.config.getConfig().isConfigured()) {
			await this.allFlagsMetadata();
		}
		return await this.flagMetadata[flag];
	}

	async allFlagsMetadata(): Promise<Dictionary<FeatureFlag>> {
		await this.ldClient; // Just waiting for initialization to complete, don't actually need the client
		if (this.flagMetadata === undefined && this.config.getConfig().isConfigured()) {
			try {
				await this.debounceUpdate();
				return this.flagMetadata;
			} catch (err) {
				console.log(`Failed getting Metadata: ${err}`);
				window.showErrorMessage(`[LaunchDarkly] ${err}`);
			}
		} else {
			return this.flagMetadata;
		}
	}

	async listFlags(): Promise<Array<string>> {
		return await Object.keys(await this.allFlagsMetadata());
	}
}
