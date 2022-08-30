import { commands, Disposable, ExtensionContext, workspace } from 'vscode';
import { Configuration } from '../configuration';

export default function enableCodeLensConfig(ctx: ExtensionContext, config: Configuration): Disposable {
	const enableCodeLens: Disposable = commands.registerCommand('launchdarkly.enableCodeLens', async () => {
		workspace.getConfiguration('launchdarkly').update('enableCodeLens', !config.enableCodeLens)
		config.enableCodeLens = !config.enableCodeLens
	});
	ctx.subscriptions.push(enableCodeLens);

	return enableCodeLens

}
