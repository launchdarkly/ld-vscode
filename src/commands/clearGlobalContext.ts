import { commands, Disposable, window } from 'vscode';
import { extensionReload } from '../utils';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

export default async function globalClearCmd(config: LDExtensionConfiguration) {
	const globalClear: Disposable = commands.registerCommand('launchdarkly.clearGlobalContext', async () => {
		try {
			await config.getConfig().clearGlobalConfig();
			await extensionReload(this, false);
			window.showInformationMessage('LaunchDarkly global settings removed');
		} catch (err) {
			console.error(`Failed clearing global context: ${err}`);
			window.showErrorMessage('An unexpected error occurred, please try again later.');
		}
	});
	config.getCtx().subscriptions.push(globalClear);
}
