import { ConfigurationChangeEvent, window } from 'vscode';
import { LDFeatureStore, LDStreamProcessor } from 'launchdarkly-node-server-sdk';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import StreamProcessor = require('launchdarkly-node-server-sdk/streaming');
import Requestor = require('launchdarkly-node-server-sdk/requestor');

import { FlagConfiguration } from './models';
import { configuration as config } from './configuration';

const PACKAGE_JSON = require('../package.json');
const DATA_KIND = { namespace: 'features' };

export class FlagStore {
	store: LDFeatureStore;
	updateProcessor: LDStreamProcessor;

	constructor() {
		this.store = InMemoryFeatureStore();
		this.start();
	}

	reload(e: ConfigurationChangeEvent) {
		if (['sdkKey', 'baseUri', 'streamUri'].some(option => e.affectsConfiguration(`launchdarkly.${option}`))) {
			this.stop();
			this.start();
		}
	}

	start() {
		if (!config.sdkKey || !config.baseUri || !config.streamUri) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return;
		}

		const ldConfig = this.ldConfig();
		this.updateProcessor = StreamProcessor(config.sdkKey, ldConfig, Requestor(config.sdkKey, ldConfig));
		this.updateProcessor.start(err => {
			if (err) {
				let errMsg: string;
				if (err.message) {
					errMsg = `Error retrieving feature flags: ${err.message}.`;
				} else {
					console.error(err);
					errMsg = `Unexpected error retrieving flags.`;
				}
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
			process.nextTick(function() {});
		});
	}

	stop() {
		this.updateProcessor && this.updateProcessor.stop();
		this.store.init({}, () => {});
	}

	private ldConfig(): any {
		return {
			timeout: 5,
			baseUri: config.baseUri,
			streamUri: config.streamUri,
			featureStore: this.store,
			logger: {
				debug: console.log,
				warn: console.warn,
				error: console.error,
			},
			userAgent: 'VSCodeExtension/' + PACKAGE_JSON.version,
		};
	}

	allFlags(): Promise<FlagConfiguration[]> {
		return new Promise(resolve => {
			this.store.all(DATA_KIND, resolve);
		});
	}
}
