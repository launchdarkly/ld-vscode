import { Disposable, workspace } from 'vscode';
import { CMD_LD_ENABLE_LENS } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';

export default function enableCodeLensConfig(config: ILDExtensionConfiguration): Disposable {
	const enableCodeLens: Disposable = registerCommand(CMD_LD_ENABLE_LENS, async () => {
		workspace.getConfiguration('launchdarkly').update('enableCodeLens', !config.getConfig().enableCodeLens);
		config.getConfig().enableCodeLens = !config.getConfig().enableCodeLens;
	});
	config.getCtx().subscriptions.push(enableCodeLens);

	return enableCodeLens;
}
