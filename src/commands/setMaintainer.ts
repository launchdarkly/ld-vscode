import { Disposable, window } from 'vscode';
import { CMD_LD_SET_MAINTAINER } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';

// This function is only called from a location that already checks if a team is available.
// If that changes more logic needs to be moved here
export default function setMaintainerCmd(config: ILDExtensionConfiguration): Disposable {
	const setMaintainerCmd = registerCommand(CMD_LD_SET_MAINTAINER, async (args) => {
		try {
			const key = args;
			if (key) {
				const patches = [
					{
						op: 'remove',
						path: '/maintainerId',
					},
					{
						op: 'replace',
						path: '/maintainerTeamKey',
						value: config.getSession()?.teams[0].key,
					},
				];
				const patchComment = {
					comment: 'Set maintainer to team maintainer',
					patch: patches,
				};
				await config.getApi().patchFeatureFlag(config.getConfig().project, key, patchComment);
			}
		} catch (err) {
			window.showErrorMessage(`Could not patch flag: ${err.message}`);
		}
	});
	config.getCtx().subscriptions.push(setMaintainerCmd);

	return setMaintainerCmd;
}
