import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { ConfigurationMenu } from '../configurationMenu';
import { FlagStore } from '../flagStore';
import { LaunchDarklyTreeViewProvider } from '../providers/flagsView';
import { LaunchDarklyMetricsTreeViewProvider } from '../providers/metricsView';
import { QuickLinksListProvider } from '../providers/quickLinksView';
import { createViews } from '../utils';

export default async function configureLaunchDarkly(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
	flagStore?: FlagStore,
	flagView?: LaunchDarklyTreeViewProvider,
) {
	const configureExtension: Disposable = commands.registerCommand('extension.configureLaunchDarkly', async () => {
		try {
			const configurationMenu = new ConfigurationMenu(config, api);
			await configurationMenu.configure();
			if (typeof flagStore === 'undefined') {
				flagStore = new FlagStore(config, api);
			} else {
				await flagStore.reload();
			}

			await createViews(api, config, ctx, flagStore);
			await ctx.globalState.update('LDConfigured', true);
			window.showInformationMessage('LaunchDarkly configured successfully');
		} catch (err) {
			console.error(`Failed configuring LaunchDarkly Extension(provider): ${err}`);
			window.showErrorMessage('An unexpected error occurred, please try again later.');
		}
	});
	ctx.subscriptions.push(configureExtension);
}
