'use strict';

import { commands, window, workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';

let config: Configuration;
let flagStore: FlagStore;

export function activate(ctx: ExtensionContext) {
	config = new Configuration(ctx);

	const validationError = config.validate();
	switch (validationError) {
		case 'unconfigured':
			window
				.showInformationMessage('To enable the LaunchDarkly extension, select your desired environment.', 'Configure')
				.then(item => item && commands.executeCommand('extension.configureLaunchDarkly'));
			break;
		case 'legacy':
			window
				.showWarningMessage(
					'Your LaunchDarkly extension configuration has been deprecated and may not work correctly. Please reconfigure the extension.',
					'Configure',
				)
				.then(item => {
					item === 'Configure'
						? commands.executeCommand('extension.configureLaunchDarkly')
						: ctx.globalState.update('legacyNotificationDismissed', true);
				});
			break;
	}

	const api = new LaunchDarklyAPI(config);
	flagStore = new FlagStore(config, api);

	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			await config.reload();
			await flagStore.reload(e);
		}
	});

	registerProviders(ctx, config, flagStore, api);
}

export function deactivate() {
	flagStore && flagStore.stop();
}
