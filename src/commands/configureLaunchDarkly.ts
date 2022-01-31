import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { ConfigurationMenu } from '../configurationMenu';
import { FlagStore } from '../flagStore';
import { setupComponents } from '../utils';

export default async function configureLaunchDarkly(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
	flagStore?: FlagStore,
	disposables?: Array<Disposable>,
) {
	const configureExtension: Disposable = commands.registerCommand('extension.configureLaunchDarkly', async () => {
		try {
			const configurationMenu = new ConfigurationMenu(config, api, ctx, disposables);
			await configurationMenu.configure();
			if (typeof flagStore === 'undefined') {
				flagStore = new FlagStore(config, api);
			} else {
				await flagStore.reload();
			}
			//console.log("here")
			//console.log(disposables)
			//await setupComponents(api, config, ctx, flagStore, disposables);
			await ctx.globalState.update('LDConfigured', true);
			window.showInformationMessage('LaunchDarkly configured successfully');
		} catch (err) {
			console.error(`Failed configuring LaunchDarkly Extension(provider): ${err}`);
			window.showErrorMessage('An unexpected error occurred, please try again later.');
		}
	});
	ctx.subscriptions.push(configureExtension);
}
