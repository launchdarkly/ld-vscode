import { ConfigurationChangeEvent, commands, window, EventEmitter } from 'vscode';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import LaunchDarkly = require('launchdarkly-node-server-sdk');

import { debounce } from 'lodash';

import { FeatureFlag, FlagConfiguration, FlagWithConfiguration, FeatureFlagConfig } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import * as cron from 'cron';

const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (flag: FeatureFlag) => void;
type LDClientResolve = (LDClient: LaunchDarkly.LDClient) => void;
type LDClientReject = () => void;
export type FlagMap = { [key: string]: FeatureFlag }

export class FlagStore {
	private readonly config: Configuration;
	private readonly store: LaunchDarkly.LDFeatureStore;
	public flagMetadata: FlagMap;
	private readonly api: LaunchDarklyAPI;
	private resolveLDClient: LDClientResolve;
	private rejectLDClient: LDClientReject;
	private ldClient: Promise<LaunchDarkly.LDClient> = new Promise((resolve, reject) => {
		this.resolveLDClient = resolve;
		this.rejectLDClient = reject;
	});
	public storeUpdates: EventEmitter<string | null> = new EventEmitter();

	constructor(config: Configuration, api: LaunchDarklyAPI, flagMetadata: FlagMap) {
		this.config = config;
		this.api = api;
		this.store = InMemoryFeatureStore();
		this.start();
		this.flagMetadata = flagMetadata;
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
			this.on('update', async flag => {
				try {
					const updatedFlag = await this.getFeatureFlag(flag.key);
					//Object.keys(updatedFlag).map(flag => {
						//this.flagMetadata[flag] = updatedFlag[flag];
						console.log("flag updated")
						console.log(updatedFlag.key)
						this.storeUpdates.fire(updatedFlag.key);
					//})
				} catch (err) {
					console.error('Failed to update LaunchDarkly flag store.', err);
				}
			});
			this.cron()
		} catch (err) {
			this.rejectLDClient();
			console.error(err);
		}
	}

	private async cron() {
		var CronJob = cron.CronJob;
			var job = new CronJob('*/2 * * * *', async () => {
				console.log('Fetching Feature Flags');
				const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
				const arrayToObject = (array: Array<FeatureFlag>) =>
					array.reduce((obj: { [key: string]: FeatureFlag }, item):  { [key: string]: FeatureFlag } => {
						obj[item.key] = item;
						return obj;
					}, {});
				this.flagMetadata = arrayToObject(flags);
				console.log(this.flagMetadata["time-to-turn-on"])
				this.storeUpdates.fire(null)
			}, null, true, 'America/Los_Angeles');
			job.start();
	}

	private async on(event: string, cb: FlagUpdateCallback) {
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

	getFeatureFlag(key: string): Promise<FeatureFlag> {
		let flag = JSON.parse(JSON.stringify(this.flagMetadata[key]));
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
				const retFlag = await this.mergeFlag(flag, res)
				resolve(retFlag)
			});
		});
	}

	async allFlags(): Promise<Object> {
		await this.ldClient
		var flagDeepClone = JSON.parse(JSON.stringify(this.flagMetadata))
		return new Promise(resolve => {
			return this.store.all(DATA_KIND, async (res: Object) => {
				resolve(await this.mergeAll(flagDeepClone, res))
			}
		);
		})
	}

	async mergeAll(flags, targeting): Promise<FlagMap> {
		var env = this.config.env
		let newObj = {}
		Object.keys(flags).map((key, idx, arr) => {
			var tempSpot = flags[key]["environments"]
			delete flags[key]["environments"]
			newObj[key] = {
				...flags[key],
				"environments": {
					[env]: {
						...tempSpot[this.config.env],
						...targeting[key]
					}
				}
			}
		})
		return newObj
	}

	async mergeFlag(flag: FeatureFlag, targeting: FlagConfiguration): Promise<FeatureFlag> {
		var env = this.config.env
		let newEnv = Object.assign({}, flag["environments"][env], targeting)
		flag["environments"][env] = newEnv
		console.log(flag)
		return flag
	}
}
