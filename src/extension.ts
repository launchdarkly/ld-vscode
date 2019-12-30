'use strict';

import { workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { flagStore } from './flags';
import { configuration as config } from './configuration';

export function activate(ctx: ExtensionContext) {
	workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			config.reload();
			flagStore.reload(e);
		}
	});

	flagStore.registerProviders(ctx);
}

export function deactivate() {
	flagStore.stop();
}
