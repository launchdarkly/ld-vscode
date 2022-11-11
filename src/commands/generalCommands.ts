import { Disposable, ExtensionContext } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import createFlagCmd from './createFlag';
import openInLdCmd from './openLaunchDarkly';
import toggleFlagCtxCmd from './toggleFlagContext';
import enableCodeLensConfig from './enableCodeLens';
import configureEnvironmentCmd from './configureLaunchDarklyEnvironment';
export default async function generalCommands(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
	flagStore: FlagStore,
) {
	const createFlag = createFlagCmd(ctx, config, api);
	const toggleFlagCmd = toggleFlagCtxCmd(ctx, config, api, flagStore);
	const openLdCmd = openInLdCmd(ctx, config, flagStore);
	const enableCodeLens = enableCodeLensConfig(ctx, config);
	const envCmd = await configureEnvironmentCmd(ctx, config, api);

	return Disposable.from(createFlag, toggleFlagCmd, openLdCmd, enableCodeLens, envCmd);
}
