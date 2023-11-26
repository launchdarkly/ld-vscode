import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';

export default function toggleFlagCtxCmd(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
): Disposable {
	const toggleFlagCtxCmd = commands.registerCommand('launchdarkly.toggleFlagContext', async (args) => {
		try {
			const key = args ? args : (ctx.workspaceState.get('LDFlagKey') as string);

			if (key) {
				const env = await global.ldContext.flagStore.getFeatureFlag(key);
				await api.patchFeatureFlagOn(config.project, key, !env.config.on);
			}
		} catch (err) {
			window.showErrorMessage(`Could not patch flag: ${err.message}`);
		}
	});
	ctx.subscriptions.push(toggleFlagCtxCmd);

	return toggleFlagCtxCmd;
}
