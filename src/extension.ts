'use strict';

import { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { FlagStore } from './flagStore';
import { configuration as config } from './configuration';
import { register as registerProviders } from './providers';

const flagStore = new FlagStore();

export function activate(ctx: ExtensionContext) {
	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			config.reload();
			flagStore.reload(e);
		}
	});

	registerProviders(ctx, flagStore);
}

export function deactivate() {
	flagStore.stop();
}
