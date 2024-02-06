import { commands, window, workspace } from 'vscode';

import globalClearCmd from './commands/clearGlobalContext';
import configureLaunchDarkly from './commands/configureLaunchDarkly';
import { extensionReload, setupComponents } from './utils';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;

export async function register(config: LDExtensionConfiguration): Promise<void> {
	await globalClearCmd(config);
	await configureLaunchDarkly(config);

	// Handle manual changes to extension configuration
	// workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
	// 	if (e.affectsConfiguration('launchdarkly') && e.affectsConfiguration('launchdarkly.enableCodeLens')) {
	// 		await extensionReload(config, true);
	// 	}
	// });

	if (config.getFlagStore() !== undefined) {
		await setupComponents(config);
	}

	if (config.getConfig().enableFlagExplorer) {
		await commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}

	await commands.executeCommand(
		'setContext',
		'launchdarkly:enableMetricExplorer',
		workspace.getConfiguration('launchdarkly').get('enableMetricsExplorer', false),
	);

	config.getCtx().subscriptions.push(
		commands.registerCommand('launchdarkly.migrateConfiguration', async () => {
			try {
				const localConfig = workspace.getConfiguration('launchdarkly');
				await config.getCtx().workspaceState.update('project', localConfig['project']);
				await config.getCtx().workspaceState.update('env', localConfig['env']);
				await config.getCtx().secrets.store('launchdarkly_accessToken', localConfig['accessToken']);
				await extensionReload(config);
				window.showInformationMessage('[LaunchDarkly] Configured successfully');
			} catch (err) {
				window.showErrorMessage(`[LaunchDarkly] ${err}`);
			}
		}),
	);
}
