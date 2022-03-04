import {
	commands,
	window,
	ExtensionContext,
	workspace,
	ConfigurationChangeEvent,
} from 'vscode';

import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagNode } from './providers/flagListView';
import globalClearCmd from './commands/clearGlobalContext';
import configureLaunchDarkly from './commands/configureLaunchDarkly';
import { extensionReload, setupComponents } from './utils';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;

export async function register(
	ctx: ExtensionContext,
	config: Configuration,
	flagStore: FlagStore,
	api: LaunchDarklyAPI,
): Promise<void> {
	await globalClearCmd(ctx, config);

	await configureLaunchDarkly(ctx, config, api, flagStore);

	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			extensionReload(config, ctx);
		}
	});
	if (!config.isConfigured) {
		return;
	}
	if (typeof flagStore !== 'undefined') {
		setupComponents(api, config, ctx, flagStore);

		ctx.subscriptions.push(
			commands.registerCommand('launchdarkly.OpenFlag', (node: FlagNode) =>
				window.activeTextEditor.revealRange(node.range),
			),
		);
	}

	if (config.enableFlagExplorer) {
		commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}
}
