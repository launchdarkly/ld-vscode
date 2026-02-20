import { ExtensionContext, window } from 'vscode';
import { CMD_LD_SET_GLOBAL_DEFAULT } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';

export function SetGlobalCmd(ctx: ExtensionContext) {
	const proj = ctx.workspaceState.get('project');
	const env = ctx.workspaceState.get('env');
	const disposable = registerCommand(CMD_LD_SET_GLOBAL_DEFAULT, () => {
		// The code you want to run when the command is executed
		window
			.showInformationMessage(
				`Do you want to set the current Project: ${proj} and Environment: ${env} as the global defaults?`,
				{ modal: true },
				{ title: 'Copy Settings' },
			)
			.then(async (selection) => {
				if (selection.title === 'Copy Settings') {
					await ctx.globalState.update('project', proj);
					await ctx.globalState.update('env', env);
				}
			});
	});

	//ctx.subscriptions.push(disposable);
	return disposable;
}
