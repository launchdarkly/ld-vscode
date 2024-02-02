import { Disposable, workspace } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { registerCommand } from '../utils';

export default function enableCodeLensConfig(config: LDExtensionConfiguration): Disposable {
	const enableCodeLens: Disposable = registerCommand('launchdarkly.enableCodeLens', async () => {
		workspace.getConfiguration('launchdarkly').update('enableCodeLens', !config.getConfig().enableCodeLens);
		config.getConfig().enableCodeLens = !config.getConfig().enableCodeLens;
	});
	config.getCtx().subscriptions.push(enableCodeLens);

	return enableCodeLens;
}
