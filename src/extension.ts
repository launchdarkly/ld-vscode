'use strict';

import { commands, window, workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';

import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';
import { FeatureFlag } from './models';
import * as _ from 'lodash';

let config: Configuration;
let flagStore: FlagStore;

export async function activate(ctx: ExtensionContext): Promise<void> {
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
	const flags = await api.getFeatureFlags(config.project, config.env);
	const flagMap = _.keyBy(flags, 'key');
	flagStore = new FlagStore(config, api, flagMap);
	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			await config.reload();
			await flagStore.reload(e);
			await commands.executeCommand('launchdarkly.treeviewrefresh');
		}
	});

	registerProviders(ctx, config, flagStore, api);
}

export function deactivate(): void {
	flagStore && flagStore.stop();
}
