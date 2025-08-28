import { commands, workspace } from 'vscode';

import globalClearCmd from './commands/clearGlobalContext';
import configureLaunchDarkly from './commands/configureLaunchDarkly';
import { setupComponents } from './generalUtils';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;

export async function register(config: LDExtensionConfiguration): Promise<void> {
	await globalClearCmd(config);
	await configureLaunchDarkly(config);

	// Handle manual changes to extension configuration
	// workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
	// 	if (e.affectsConfiguration('launchdarkly') && e.affectsConfiguration(CMD_LD_ENABLE_LENS)) {
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
}
