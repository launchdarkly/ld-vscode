import { Disposable } from 'vscode';
import { CreateFlagMenu } from '../createFlagMenu';
import { CMD_LD_CREATE_FLAG } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';
import { analytics } from '../analytics';

export default function createFlagCmd(config: ILDExtensionConfiguration): Disposable {
	const createFlagCmd = registerCommand(CMD_LD_CREATE_FLAG, async () => {
		analytics.track('flag-created');
		const configurationMenu = new CreateFlagMenu(config);
		await configurationMenu.collectInputs();
	});

	config.getCtx().subscriptions.push(createFlagCmd);

	return createFlagCmd;
}
