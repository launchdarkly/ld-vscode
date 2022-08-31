import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { LaunchDarklyAPI, sortNameCaseInsensitive } from '../api';
import { Configuration } from '../configuration';
import { extensionReload } from '../utils';

export default function configureEnvironmentCmd(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
): Disposable {
	const configureEnvironmentCmd = commands.registerCommand(
		'launchdarkly.configureLaunchDarklyEnvironment',
		async () => {
			const project = await api.getProject(config.project);
			const environments = project.environments.sort(sortNameCaseInsensitive);
			const newEnvironment = await window.showQuickPick(environments.map((env) => env.key));
			if (newEnvironment !== 'undefined') {
				config.update('env', newEnvironment, false);
				extensionReload(config, ctx);
			}
		},
	);

	ctx.subscriptions.push(configureEnvironmentCmd);

	return configureEnvironmentCmd;
}
