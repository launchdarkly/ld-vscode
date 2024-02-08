import { Disposable } from 'vscode';
import { CreateFlagMenu } from '../createFlagMenu';
import { CMD_LD_CREATE_FLAG } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';

export default function createFlagCmd(config: ILDExtensionConfiguration): Disposable {
	const createFlagCmd = registerCommand(CMD_LD_CREATE_FLAG, async () => {
		const configurationMenu = new CreateFlagMenu(config);
		await configurationMenu.collectInputs();
	});

	config.getCtx().subscriptions.push(createFlagCmd);

	return createFlagCmd;
}
