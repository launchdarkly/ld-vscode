import { Disposable } from 'vscode';
import createFlagCmd from './createFlag';
import openInLdCmd from './openLaunchDarkly';
import toggleFlagCtxCmd from './toggleFlagContext';
import enableCodeLensConfig from './enableCodeLens';
import configureEnvironmentCmd from './configureLaunchDarklyEnvironment';
import selectRuleCmd from './selectRule';
import setMaintainerCmd from './setMaintainer';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

export default async function generalCommands(LDExtenConfig: LDExtensionConfiguration) {
	const createFlag = createFlagCmd(LDExtenConfig.getCtx(), LDExtenConfig.getConfig(), LDExtenConfig.getApi());
	const toggleFlagCmd = toggleFlagCtxCmd(LDExtenConfig.getCtx(), LDExtenConfig.getConfig(), LDExtenConfig.getApi());
	const setMaintainerCmd1 = setMaintainerCmd(LDExtenConfig);
	const openLdCmd = openInLdCmd(LDExtenConfig.getCtx(), LDExtenConfig.getConfig(), LDExtenConfig.getFlagStore());
	const enableCodeLens = enableCodeLensConfig(LDExtenConfig.getCtx(), LDExtenConfig.getConfig());
	const envCmd = await configureEnvironmentCmd(LDExtenConfig);
	const selRuleCmd = selectRuleCmd(LDExtenConfig);
	return Disposable.from(createFlag, toggleFlagCmd, openLdCmd, enableCodeLens, envCmd, selRuleCmd, setMaintainerCmd1);
}
