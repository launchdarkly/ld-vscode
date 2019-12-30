'use strict';

import { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';

let config: Configuration;
let flagStore: FlagStore;

export function activate(ctx: ExtensionContext) {
	config = new Configuration(ctx);
	flagStore = new FlagStore(config);

	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			config.reload();
			flagStore.reload(e);
		}
	});

	registerProviders(ctx, config, flagStore);
}

export function deactivate() {
	flagStore && flagStore.stop();
}
