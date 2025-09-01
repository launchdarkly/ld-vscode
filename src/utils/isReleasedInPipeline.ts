import { FeatureFlag, ILaunchDarklyReleaseProvider } from '../models';
import { LaunchDarklyReleaseProvider } from '../providers/releaseViewProvider';

export const isReleasedInPipeline = async (flag: FeatureFlag, releaseViewProvider: LaunchDarklyReleaseProvider) => {
	const releasePhases = releaseViewProvider.flagStatus[flag.key];
	if (!releasePhases?.release) {
		return { status: 'Unknown, not associated with a Release Pipeline', phaseKey: 'No release found' };
	}
	const releasePipeline = releaseViewProvider.releaseData[releasePhases.release];

	const index = releasePipeline.findIndex((phase) => phase.key === releasePhases.phase);

	return {
		status: index === releasePipeline.length - 1 && releasePhases.phase === 'released' ? 'passed' : 'in progress',
		phaseKey: releasePipeline.phase,
		phaseIndex: index,
		totalPhases: releasePhases.length - 1,
	};
};

export const isReleasedInPipelineCheck = async (
	flag: FeatureFlag,
	releaseViewProvider: ILaunchDarklyReleaseProvider,
) => {
	const releasePhases = releaseViewProvider.flagStatus[flag.key];
	return releasePhases.phase === 'released';
};
