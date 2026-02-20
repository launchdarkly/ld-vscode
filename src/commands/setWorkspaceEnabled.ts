import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { extensionReload } from '../generalUtils';
import { CMD_LD_ENABLE_WORKSPACE } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';

export function SetWorkspaceCmd(config: LDExtensionConfiguration) {
	const disposable = registerCommand(CMD_LD_ENABLE_WORKSPACE, async () => {
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
