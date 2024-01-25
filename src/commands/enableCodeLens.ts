import { commands, Disposable, workspace } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

export default function enableCodeLensConfig(config: LDExtensionConfiguration): Disposable {
	const enableCodeLens: Disposable = commands.registerCommand('launchdarkly.enableCodeLens', async () => {
		workspace.getConfiguration('launchdarkly').update('enableCodeLens', !config.getConfig().enableCodeLens);
		config.getConfig().enableCodeLens = !config.getConfig().enableCodeLens;
	});
	config.getCtx().subscriptions.push(enableCodeLens);

	return enableCodeLens;
}
