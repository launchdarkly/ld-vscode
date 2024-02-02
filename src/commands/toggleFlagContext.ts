import { Disposable, window } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { registerCommand } from '../utils';

export default function toggleFlagCtxCmd(config: LDExtensionConfiguration): Disposable {
	const toggleFlagCtxCmd = registerCommand('launchdarkly.toggleFlagContext', async (args) => {
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
