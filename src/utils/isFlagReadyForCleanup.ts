import { ILDExtensionConfiguration, StaleConfig } from '../models';
import { LaunchDarklyReleaseProvider } from '../providers/releaseViewProvider';
import { hasDependentFlags } from './hasDependentFlags';
import { isReleasedInPipeline, isReleasedInPipelineCheck } from './isReleasedInPipeline';
import { isStableInCriticalEnvs, isStableInCriticalEnvsCheck } from './isStableInCriticalEnvs';

export type CheckData = {
	dependentFlagsExist: object;
	passesReleaseCheck: object;
	criticalEnvironments: object;
	isTemporary: boolean;
};
export const isFlagReadyForCleanup = async (
	ldConfig: ILDExtensionConfiguration,
	flagKey: string,
	releaseViewProvider: LaunchDarklyReleaseProvider,
	yamlConfig?: StaleConfig,
): Promise<CheckData> => {
	const { skipCriticalEnvironmentsCheck, skipReleasePipelinesCheck, skipFlagTemporary } = yamlConfig || {};
	const dependentFlagsExist = await hasDependentFlags(ldConfig, flagKey);
	const checkData = {};
	checkData['Dependent flags exist'] = dependentFlagsExist;

	const flag = await ldConfig.getFlagStore()?.getFeatureFlag(flagKey);

	if (!skipReleasePipelinesCheck) {
		checkData['Pass Release Pipeline Check'] = await isReleasedInPipeline(flag.flag, releaseViewProvider);
	}

	if (!skipCriticalEnvironmentsCheck) {
		checkData['criticalEnvironments'] = isStableInCriticalEnvs(flag.flag, ldConfig, yamlConfig);
	}

	if (!skipFlagTemporary) {
		checkData['Temporary only'] = flag?.flag.temporary;
	}

	return checkData as CheckData;
};

export const isFlagReadyForCleanupCheck = async (
	ldConfig: ILDExtensionConfiguration,
	flagKey: string,
	yamlConfig?: StaleConfig,
): Promise<{ result: boolean; reason: string }> => {
	const { skipCriticalEnvironmentsCheck, skipReleasePipelinesCheck } = yamlConfig || {};
	let passesCriticalEnvsCheck = true;
	let passesReleaseCheck = true;
	const dependentFlagsExist = await hasDependentFlags(ldConfig, flagKey);
	const flag = await ldConfig.getFlagStore()?.getFeatureFlag(flagKey);
	if (dependentFlagsExist.length > 0) {
		return { result: false, reason: 'Dependent flags exist' };
	} else if (skipCriticalEnvironmentsCheck && skipReleasePipelinesCheck) {
		return { result: true, reason: 'Skipped checks' };
	}

	if (!skipReleasePipelinesCheck) {
		passesReleaseCheck = await isReleasedInPipelineCheck(flag.flag, ldConfig.getReleaseView());
	}
	if (!passesReleaseCheck) {
		return { result: false, reason: 'Not released in pipeline' };
	}

	if (!skipCriticalEnvironmentsCheck) {
		passesCriticalEnvsCheck = isStableInCriticalEnvsCheck(flag.flag, ldConfig, yamlConfig);
	}

	return { result: passesReleaseCheck && passesCriticalEnvsCheck, reason: 'Ready for cleanup' };
};
