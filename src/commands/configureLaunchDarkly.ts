import { Disposable, ProgressLocation, window } from 'vscode';
import { ConfigurationMenu } from '../configurationMenu';
import { FlagStore } from '../flagStore';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { registerCommand } from '../utils';

export default function configureLaunchDarkly(config: LDExtensionConfiguration) {
	const configureExtension: Disposable = registerCommand('extension.configureLaunchDarkly', async () => {
		try {
			const configurationMenu = new ConfigurationMenu(config);
			await configurationMenu.configure();
			if (config.getFlagStore() === null) {
				config.setFlagStore(new FlagStore(config));
			} else {
				await config.getFlagStore().reload();
			}
			await config.getCtx().globalState.update('LDConfigured', true);
			window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: '[LaunchDarkly] Configured successfully',
					cancellable: false,
				},
				() => {
					return new Promise((resolve) => {
						setTimeout(resolve, 1500);
					});
				},
			);
		} catch (err) {
			console.error(`Failed configuring LaunchDarkly Extension(provider): ${err}`);
			window.showErrorMessage('An unexpected error occurred, please try again later.');
		}
	});

	config.getCtx().subscriptions.push(configureExtension);
}
