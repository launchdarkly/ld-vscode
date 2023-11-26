import { commands, Disposable, window } from 'vscode';
import { sortNameCaseInsensitive } from '../api';
import { extensionReload } from '../utils';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

export default async function configureEnvironmentCmd(config: LDExtensionConfiguration): Promise<Disposable> {
	const configureEnvironmentCmd = commands.registerCommand(
		'launchdarkly.configureLaunchDarklyEnvironment',
		async () => {
			try {
				const project = await config.getApi().getProject(config.getConfig().project);
				const environments = project.environments.sort(sortNameCaseInsensitive);
				const newEnvironment = await window.showQuickPick(environments.map((env) => env.key));
				if (newEnvironment !== 'undefined') {
					await config.getConfig().update('env', newEnvironment, false);
					await extensionReload(config, true);
				}
			} catch (err) {
				console.log(err);
				window.showErrorMessage(`[LaunchDarkly] ${err}`);
			}
		},
	);

	config.getCtx().subscriptions.push(configureEnvironmentCmd);

	return configureEnvironmentCmd;
}
