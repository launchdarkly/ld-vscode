import { Disposable } from 'vscode';
import createFlagCmd from './createFlag';
import openInLdCmd from './openLaunchDarkly';
import toggleFlagCtxCmd from './toggleFlagContext';
import enableCodeLensConfig from './enableCodeLens';
import configureEnvironmentCmd from './configureLaunchDarklyEnvironment';
import selectRuleCmd from './selectRule';
import setMaintainerCmd from './setMaintainer';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { SetGlobalCmd } from './setGlobal';
import flagCmd from './flagActions';

export default async function generalCommands(LDExtenConfig: LDExtensionConfiguration) {
	const createFlag = createFlagCmd(LDExtenConfig);
	const toggleFlagCmd = toggleFlagCtxCmd(LDExtenConfig);
	const setMaintainerCmd1 = setMaintainerCmd(LDExtenConfig);
	const openLdCmd = openInLdCmd(LDExtenConfig);
	const enableCodeLens = enableCodeLensConfig(LDExtenConfig);
	const envCmd = await configureEnvironmentCmd(LDExtenConfig);
	const selRuleCmd = selectRuleCmd(LDExtenConfig);
	const setGlobal = SetGlobalCmd(LDExtenConfig.getCtx());
	const flgActionsCmd = flagCmd(LDExtenConfig);
	return Disposable.from(
		createFlag,
		toggleFlagCmd,
		openLdCmd,
		enableCodeLens,
		envCmd,
		selRuleCmd,
		setMaintainerCmd1,
		setGlobal,
		flgActionsCmd,
	);
}
