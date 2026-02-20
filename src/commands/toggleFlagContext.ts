import { Disposable, window } from 'vscode';
import { CMD_LD_TOGGLE_CTX } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';

export default function toggleFlagCtxCmd(config: ILDExtensionConfiguration): Disposable {
	const toggleFlagCtxCmd = registerCommand(CMD_LD_TOGGLE_CTX, async (args) => {
		try {
			const key = args ? args : (config.getCtx().workspaceState.get('LDFlagKey') as string);

			if (key) {
				const env = await config.getFlagStore().getFeatureFlag(key);
				await config.getApi().patchFeatureFlagOn(config.getConfig().project, key, !env.config.on);
			}
		} catch (err) {
			window.showErrorMessage(`Could not patch flag: ${err.message}`);
		}
	});
	config.getCtx().subscriptions.push(toggleFlagCtxCmd);

	return toggleFlagCtxCmd;
}
