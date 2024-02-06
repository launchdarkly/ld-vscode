import { Disposable } from 'vscode';
import { CreateFlagMenu } from '../createFlagMenu';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { registerCommand } from '../utils';

export default function createFlagCmd(config: LDExtensionConfiguration): Disposable {
	const createFlagCmd = registerCommand('launchdarkly.createFlag', async () => {
		const configurationMenu = new CreateFlagMenu(config);
		await configurationMenu.collectInputs();
	});

	config.getCtx().subscriptions.push(createFlagCmd);

	return createFlagCmd;
}
