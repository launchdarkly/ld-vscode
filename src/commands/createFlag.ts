import { commands, Disposable } from 'vscode';
import { CreateFlagMenu } from '../createFlagMenu';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

export default function createFlagCmd(config: LDExtensionConfiguration): Disposable {
	const createFlagCmd = commands.registerCommand('launchdarkly.createFlag', async () => {
		const configurationMenu = new CreateFlagMenu(config);
		await configurationMenu.collectInputs();
	});

	config.getCtx().subscriptions.push(createFlagCmd);

	return createFlagCmd;
}
