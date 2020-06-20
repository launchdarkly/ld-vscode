import { ConfigurationChangeEvent, commands, window, EventEmitter, workspace } from 'vscode';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import LaunchDarkly = require('launchdarkly-node-server-sdk');

import { debounce } from 'lodash';

import { FeatureFlag, FlagConfiguration } from './models';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import * as cron from 'cron';

const DATA_KIND = { namespace: 'features' };

type FlagUpdateCallback = (flag: FeatureFlag) => void;
type LDClientResolve = (LDClient: LaunchDarkly.LDClient) => void;
type LDClientReject = () => void;
export type FlagMap = { [key: string]: FeatureFlag };

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
					this.storeUpdates.fire(updatedFlag.key);
				} catch (err) {
					console.error('Failed to update LaunchDarkly flag store.', err);
				}
			});
			if (this.config.refreshCron) {
				if (this.config.validateCron(this.config.refreshCron)) {
					this.cron(this.config.refreshCron);
				} else {
					window.showErrorMessage(
						`Invalid cron expression: '${this.config.refreshCron}' needs to be 5 field cron format.`,
					);
				}
			}
		} catch (err) {
			this.rejectLDClient();
			console.error(err);
		}
	}

	private async cron(exp: string) {
		var CronJob = cron.CronJob;
		var job = new CronJob(
			exp,
			async () => {
				this.updateFlags();
			},
			null,
			true,
		);
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
					} catch (err) {
						let message = 'Error retrieving Flags';
						if (err.statusCode === 401) {
							message = 'Unauthorized';
						} else if (
							err.statusCode === 404 ||
							(err.statusCode === 400 && err.message.includes('Unknown environment key'))
						) {
							message = 'Configured environment does not exist.';
						}
					}
				}
				const retFlag = await this.mergeFlag(flag, res);
				resolve(retFlag);
			});
		});
	}

	async allFlags(): Promise<Object> {
		await this.ldClient;
		var flagDeepClone = JSON.parse(JSON.stringify(this.flagMetadata));
		return new Promise(resolve => {
			return this.store.all(DATA_KIND, async (res: Object) => {
				resolve(await this.mergeAll(flagDeepClone, res));
			});
		});
	}

	private async mergeAll(flags, targeting): Promise<FlagMap> {
		var env = this.config.env;
		let newObj = {};
		Object.keys(flags).map((key, idx, arr) => {
			var tempSpot = flags[key]['environments'];
			delete flags[key]['environments'];
			newObj[key] = {
				...flags[key],
				environments: {
					[env]: {
						...tempSpot[this.config.env],
						...targeting[key],
					},
				},
			};
		});
		return newObj;
	}

	private async mergeFlag(flag: FeatureFlag, targeting: FlagConfiguration): Promise<FeatureFlag> {
		var env = this.config.env;
		let newEnv = Object.assign({}, flag['environments'][env], targeting);
		flag['environments'][env] = newEnv;
		return flag;
	}

	async updateFlags() {
		await this.debounceUpdate();
	}

	private readonly debounceUpdate = debounce(
		async () => {
			try {
				const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
				const arrayToObject = (array: Array<FeatureFlag>) =>
					array.reduce((obj: { [key: string]: FeatureFlag }, item): { [key: string]: FeatureFlag } => {
						obj[item.key] = item;
						return obj;
					}, {});
				this.flagMetadata = arrayToObject(flags);
				this.storeUpdates.fire(null);
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
