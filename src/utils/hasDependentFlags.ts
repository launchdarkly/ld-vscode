import { ILDExtensionConfiguration } from '../models';

export const hasDependentFlags = async (ldConfig: ILDExtensionConfiguration, flagKey: string) => {
	const dependentFlags = await ldConfig.getApi().listDependentFeatureFlags(ldConfig.getConfig().project, flagKey);

	return dependentFlags.map((flag) => flag.key);
};

export const hasDependentFlagsCheck = async (ldConfig: ILDExtensionConfiguration, flagKey: string) => {
	const dependentFlags = await ldConfig.getApi().listDependentFeatureFlags(ldConfig.getConfig().project, flagKey);

	return dependentFlags.length > 0;
};
