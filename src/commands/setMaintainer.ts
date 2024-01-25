import { commands, Disposable, window } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

// This function is only called from a location that already checks if a team is available.
// If that changes more logic needs to be moved here
export default function setMaintainerCmd(config: LDExtensionConfiguration): Disposable {
	const setMaintainerCmd = commands.registerCommand('launchdarkly.setMaintainer', async (args) => {
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
