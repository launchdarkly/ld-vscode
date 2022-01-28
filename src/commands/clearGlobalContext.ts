import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { Configuration } from '../configuration';

export default async function globalClearCmd(ctx: ExtensionContext, config: Configuration) {
	const globalClear: Disposable = commands.registerCommand('launchdarkly.clearGlobalContext', async () => {
		try {
			await config.clearGlobalConfig();
			window.showInformationMessage('LaunchDarkly global settings removed');
		} catch (err) {
			console.error(`Failed clearing global context: ${err}`);
			window.showErrorMessage('An unexpected error occurred, please try again later.');
		}
	});
	ctx.subscriptions.push(globalClear);
}