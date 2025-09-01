import _ from 'lodash';
import { FeatureFlag, FeatureFlagConfig, ILDExtensionConfiguration, StaleConfig } from '../models';

export const isStableInCriticalEnvs = (
	flag: FeatureFlag,
	config: ILDExtensionConfiguration,
	yamlConfig: StaleConfig,
): object => {
	const threshold = getThresholdDays(yamlConfig);
	const critEnvs = config.getCtx().workspaceState.get('criticalEnvs', []);
	const output = critEnvs.reduce((acc, env) => {
		const flagEnvironment = flag?.environments[env];
		const { count, variations } = countVariations(flagEnvironment);

		const lastModified = flagEnvironment?.lastModified || 21;
		const res = lastModified < threshold;
		const passesRulesCheck = yamlConfig?.checkRulesInCriticalEnvs ? count === 1 : true;
		acc[env] = {
			lastModified: new Date(lastModified),
			passLastModifiedCheck: res,
			passesRulesCheck,
			variations,
		};

		return acc;
	}, {});

	const passLastModifiedCheck = Object.values(output).reduce((acc, env: { passLastModifiedCheck: boolean }) => {
		return acc && env.passLastModifiedCheck;
	}, true);

	Object.values(output).forEach((env: { passLastModifiedCheck: boolean }) => {
		delete env.passLastModifiedCheck;
	});

	const allVariationsEqual = checkVariationsAcrossEnvironments(output);
	output['Serving single variation across critical environments'] = allVariationsEqual;
	output['Pass last modified check'] = passLastModifiedCheck;
	return output;
};

export const isStableInCriticalEnvsCheck = (
	flag: FeatureFlag,
	config: ILDExtensionConfiguration,
	yamlConfig: StaleConfig,
): boolean => {
	const threshold = getThresholdDays(yamlConfig);
	const critEnvs = config.getCtx().workspaceState.get('criticalEnvs', []);
	const output = critEnvs.reduce((acc, env) => {
		const flagEnvironment = flag?.environments[env];
		const { count, variations } = countVariations(flagEnvironment);

		const lastModified = flagEnvironment?.lastModified || 0;
		const res = lastModified < threshold;
		const passRulesCheck = yamlConfig?.checkRulesInCriticalEnvs ? count === 1 : true;

		acc[env.key] = {
			passLastModifiedCheck: res,
			passRulesCheck,
			variations,
		};

		return acc;
	}, {});

	const allVariationsEqual = checkVariationsAcrossEnvironments(output);

	const passLastModifiedCheck = Object.values(output).reduce(
		(acc, env: { passLastModifiedCheck: boolean; passRulesCheck: boolean }) => {
			return acc && env.passLastModifiedCheck && env.passRulesCheck && allVariationsEqual;
		},
		true,
	);

	return passLastModifiedCheck as boolean;
};

const getDays = (yamlConfig: StaleConfig): number => {
	return yamlConfig?.days;
};

const getThresholdDays = (yamlConfig: StaleConfig) => {
	const days = getDays(yamlConfig);
	return new Date().getTime() - days * 24 * 60 * 60 * 1000;
};
const countVariations = (flagEnvironment: FeatureFlagConfig): { count: number; variations: number[] } => {
	let count = 0;
	const variations = [];
	for (const key in flagEnvironment._summary.variations) {
		const variationInfo = flagEnvironment._summary.variations[key];
		if (flagEnvironment.on) {
			if (
				variationInfo.rules > 0 ||
				variationInfo.targets > 0 ||
				(variationInfo.rollout > 0 && variationInfo.rollout > 0) ||
				variationInfo.contextTargets > 0 ||
				variationInfo.isFallthrough === true
			) {
				count++;
				variations.push(key);
			}
		} else if (variationInfo.isOff === true) {
			count++;
			variations.push(key);
		}
	}
	return { count, variations };
};

const checkVariationsAcrossEnvironments = (environments: Record<string, { variations: string[] }>): boolean => {
	const variationsArrays = Object.values(environments).map((env) => env.variations);
	for (let i = 0; i < variationsArrays.length - 1; i++) {
		if (!_.isEqual(variationsArrays[i], variationsArrays[i + 1])) {
			return false;
		}
	}
	return true;
};
