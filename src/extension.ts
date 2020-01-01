'use strict';

import { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';

const config = new Configuration();
const flagStore = new FlagStore(config);

export function activate(ctx: ExtensionContext) {
	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			config.reload();
			flagStore.reload(e);
		}
	});

	registerProviders(ctx, config, flagStore);
}

export function deactivate() {
	flagStore.stop();
}
