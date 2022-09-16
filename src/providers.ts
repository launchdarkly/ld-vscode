import { commands, window, ExtensionContext, workspace, ConfigurationChangeEvent } from 'vscode';

import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagItem } from './providers/flagListView';
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
		if (e.affectsConfiguration('launchdarkly') && !e.affectsConfiguration('launchdarkly.enableCodeLens')) {
			await extensionReload(config, ctx, true);
		}
	});
	if (!config.isConfigured) {
		return;
	}
	if (typeof flagStore !== 'undefined') {
		await setupComponents(api, config, ctx, flagStore);
	}

	if (config.enableFlagExplorer) {
		await commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}

	await commands.executeCommand(
		'setContext',
		'launchdarkly:enableMetricExplorer',
		workspace.getConfiguration('launchdarkly').get('enableMetricsExplorer', false),
	);

	ctx.subscriptions.push(
		commands.registerCommand('launchdarkly.migrateConfiguration', async () => {
			try {
				const localConfig = workspace.getConfiguration('launchdarkly');
				await ctx.workspaceState.update('project', localConfig['project']);
				await ctx.workspaceState.update('env', localConfig['env']);
				await extensionReload(config, ctx);
				window.showInformationMessage('[LaunchDarkly] Configured successfully');
			} catch (err) {
				window.showErrorMessage(`[LaunchDarkly] ${err}`);
			}
		}),
	);
}
