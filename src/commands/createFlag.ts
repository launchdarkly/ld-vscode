import { commands, Disposable, ExtensionContext } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { CreateFlagMenu } from '../createFlagMenu';

export default async function createFlagCmd(ctx: ExtensionContext, config: Configuration, api: LaunchDarklyAPI) {
	const createFlagCmd: Disposable = commands.registerCommand('launchdarkly.createFlag', async () => {
		const configurationMenu = new CreateFlagMenu(config, api);
		await configurationMenu.collectInputs();
	});
	ctx.subscriptions.push(createFlagCmd);
}