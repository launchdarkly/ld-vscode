import { Disposable, ExtensionContext } from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import createFlagCmd from './createFlag';
import openInLdCmd from './openLaunchDarkly';
import toggleFlagCtxCmd from './toggleFlagContext';

export default async function generalCommands(
	ctx: ExtensionContext,
	config: Configuration,
	api: LaunchDarklyAPI,
	flagStore: FlagStore,
): Promise<Array<Disposable>> {
	const disposables: Array<Disposable> = [];
	const createFlag = await createFlagCmd(ctx, config, api);
	const toggleFlagCmd = await toggleFlagCtxCmd(ctx, config, api, flagStore);
	const openLdCmd = await openInLdCmd(ctx, config, flagStore);

	disposables.push(createFlag, toggleFlagCmd, openLdCmd);
	return disposables;
}
