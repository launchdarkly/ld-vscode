'use strict';

import { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { flagStore } from './flagStore';
import { configuration as config } from './configuration';
import { register as registerProviders } from './providers';

export function activate(ctx: ExtensionContext) {
	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			config.reload();
			flagStore.reload(e);
		}
	});

	registerProviders(ctx);
}

export function deactivate() {
	flagStore.stop();
}
