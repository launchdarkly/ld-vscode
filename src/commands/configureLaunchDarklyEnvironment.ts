import { commands, Disposable, window } from 'vscode';
//import { sortNameCaseInsensitive } from '../api';
import { extensionReload } from '../generalUtils';
import { CMD_LD_CONFIG_ENV } from '../utils/commands';
import { ILDExtensionConfiguration } from '../models';

export default async function configureEnvironmentCmd(config: ILDExtensionConfiguration): Promise<Disposable> {
	const configureEnvironmentCmd = commands.registerCommand(CMD_LD_CONFIG_ENV, async () => {
		try {
			//const intConfig = config.getConfig();
			const api = config.getApi();
			if (!config.getConfig()) {
				return;
			}
			const project = await api?.getProject(config.getConfig().project);
			if (!project) {
				window.showErrorMessage(`[LaunchDarkly] Please Configure LaunchDarkly Extension`);
				return;
			}
			//const environments = project.environments.sort(sortNameCaseInsensitive);
			const environments = project.environments.items;
			const newEnvironment = await window.showQuickPick(environments.map((env) => env.key));
			if (newEnvironment) {
				await config.getConfig().update('env', newEnvironment, false);
				await extensionReload(config, true);
			}
		} catch (err) {
			console.log(err);
			window.showErrorMessage(`[LaunchDarkly] ${err}`);
		}
	});

	config.getCtx().subscriptions.push(configureEnvironmentCmd);

	return configureEnvironmentCmd;
}
