import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';

export default async function toggleFlagCtxCmd(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
	flagStore: FlagStore,
): Promise<Disposable> {
	const toggleFlagCtxCmd = commands.registerCommand('launchdarkly.toggleFlagContext', async () => {
		try {
			const key = ctx.workspaceState.get('LDFlagKey') as string;
			if (key) {
				const env = await flagStore.getFeatureFlag(key);
				await api.patchFeatureFlagOn(config.project, key, !env.config.on);
			}
		} catch (err) {
			window.showErrorMessage(`Could not patch flag: ${err.message}`);
		}
	});
	ctx.subscriptions.push(toggleFlagCtxCmd);

	return toggleFlagCtxCmd;
}
