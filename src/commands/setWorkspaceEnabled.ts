import { commands } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { extensionReload } from '../utils';

export function SetWorkspaceCmd(config: LDExtensionConfiguration) {
	const disposable = commands.registerCommand('launchdarkly.enableWorkspace', async () => {
		// The code you want to run when the command is executed
		if (
			config.getCtx().workspaceState.get('isDisabledForWorkspace') !== false ||
			config.getCtx().workspaceState.get('isDisabledForWorkspace') === undefined
		) {
			config.getCtx().workspaceState.update('isDisabledForWorkspace', undefined);
			await extensionReload(config, true);
		}
	});

	return disposable;
}
