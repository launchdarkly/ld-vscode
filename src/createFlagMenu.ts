import { ProgressLocation, QuickInput, QuickPickItem, env, tasks, window, workspace } from 'vscode';

import { MultiStepInput, QuickPickParameters } from './multiStepInput';
import { LaunchDarklyAPI } from './api';
import { kebabCase } from 'lodash';
import { FeatureFlag, NewFlag, ReleasePipeline } from './models';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
export interface State {
	name: string;
	key: string;
	description: string;
	tags: string[];
	kind: string;
	clientAvailabilityInt: string;
	mobileAvailabilityInt: string;
	temporary: boolean;
	releasePipelineKey: string;
	clientSideAvailability: sdkAvailability;
}

export type flagDefaultSettings = {
	flagName: string;
	flagKey: string;
	flagDescription: string;
};

export type sdkAvailability = {
	usingEnvironmentId: boolean;
	usingMobileKey: boolean;
};

interface PipelineQuickPickItem extends QuickPickItem {
	value: string;
}

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
export class CreateFlagMenu {
	private readonly config: LDExtensionConfiguration;
	private api: LaunchDarklyAPI;
	private title: string;
	private totalSteps: number;
	private defaults: flagDefaultSettings;
	public flag: FeatureFlag;
	private pipelines: Array<ReleasePipeline>;

	constructor(config: LDExtensionConfiguration, defaults?: flagDefaultSettings) {
		this.config = config;
		this.defaults = defaults || undefined;
		this.title = 'Create Feature Flag';
		this.totalSteps = 3;
		workspace.name && this.totalSteps++;
	}

	async collectInputs() {
		const state = {} as Partial<State>;
		this.pipelines = await this.config.getApi().getReleasePipelines(this.config.getConfig().project);
		await MultiStepInput.run((input) => this.setFlagName(input, state));
		return this.flag;
	}

	shouldResume(): Promise<boolean> {
		// Required by multiStepInput
		// Could show a notification with the option to resume.
		return new Promise<boolean>(() => {});
	}

	async setFlagName(input: MultiStepInput<QuickInput>, state: Partial<State>) {
		const name = await input.showInputBox({
			title: this.title,
			step: 1,
			value: this.defaults?.flagName ? this.defaults.flagName : '',
			prompt: 'Enter Flag Name',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => isValidName(token),
		});
		state.name = name;
		return (input: MultiStepInput<QuickInput>) => this.setFlagKey(input, state);
	}

	async setFlagKey(input: MultiStepInput<QuickInput>, state: Partial<State>) {
		const key = await input.showInputBox({
			title: this.title,
			step: 2,
			value: this.defaults?.flagKey ? this.defaults.flagKey : convertToKey(state.name),
			prompt: 'Enter Flag Key',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => isValidKey(token),
		});
		state.key = key;
		if (this.defaults?.flagDescription) {
			return (input: MultiStepInput<QuickInput>) => this.setFlagDescription(input, state);
		}
		return (input: MultiStepInput<QuickInput>) => this.setAvailability(input, state);
	}

	async setFlagDescription(input: MultiStepInput<QuickInput>, state: Partial<State>) {
		const description = await input.showInputBox({
			title: this.title,
			step: 3,
			value: this.defaults?.flagDescription ? this.defaults.flagDescription : '',
			prompt: 'Enter Flag Description',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => isValidDescription(token),
		});
		state.description = description;
		return (input: MultiStepInput<QuickInput>) => this.setAvailability(input, state);
	}

	async setAvailability(input: MultiStepInput<QuickPickItem>, state: Partial<State>) {
		const enableServer = 'Only make flag available on Server';
		const enableClient = 'Enable Client Side';
		const enableMobile = 'Enable Mobile Side';
		const enableBoth = 'Enable Both Mobile and Client';

		const availability = await input.showQuickPick({
			title: this.title,
			step: 4,
			items: [{ label: enableServer }, { label: enableClient }, { label: enableMobile }, { label: enableBoth }],
			placeholder: 'Select Client-side Availability',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
		});

		const flagAvailability: sdkAvailability = {
			usingEnvironmentId: false,
			usingMobileKey: false,
		};
		switch (availability.label) {
			case enableClient:
				flagAvailability.usingEnvironmentId = true;
				break;
			case enableMobile:
				flagAvailability.usingMobileKey = true;
				break;
			case enableBoth:
				flagAvailability.usingEnvironmentId = true;
				flagAvailability.usingMobileKey = true;
				break;
			default:
				break;
		}

		if (this.pipelines.length > 0) {
			state.clientSideAvailability = flagAvailability;
			return (input: MultiStepInput<QuickInput>) => this.setPipeline(input, state);
		}
		const buildFlag: NewFlag = Object.assign(state);
		buildFlag['clientSideAvailability'] = flagAvailability;
		// Remove empty fields
		Object.keys(buildFlag).forEach((k) => buildFlag[k] == null && delete buildFlag[k]);

		try {
			const flag = await this.config.getApi().postFeatureFlag(this.config.getConfig().project, buildFlag);
			env.clipboard.writeText(flag.key);
			window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: '[LaunchDarkly] Flag: ${flag.key} created and key copied to your clipboard.',
					cancellable: false,
				},
				() => {
					return new Promise((resolve) => {
						setTimeout(resolve, 2000);
					});
				},
			);
			this.flag = flag;
			const getTasks = await tasks.fetchTasks();
			for (const t of getTasks) {
				if (t.name === 'LDFlagGenerator') {
					await tasks.executeTask(t);
				}
			}
		} catch (err) {
			window.showErrorMessage(`[LaunchDarkly] Creating flag ${err}`);
		}
	}

	async setPipeline(input: MultiStepInput<QuickInput>, state: Partial<State>) {
		const emptyPipeline = {
			label: 'Skip Pipeline',
			value: '',
		};
		const pipelineOptions = this.pipelines.map((item) => {
			return {
				label: item.name,
				description: item.description,
				value: item.key,
			};
		});
		const pipeline = await input.showQuickPick<PipelineQuickPickItem, QuickPickParameters<PipelineQuickPickItem>>({
			items: [emptyPipeline, ...pipelineOptions],
			title: this.title,
			step: 5,
			totalSteps: this.totalSteps,
			placeholder: 'Select a pipeline',
			shouldResume: this.shouldResume,
		});

		if (pipeline.value) {
			state.releasePipelineKey = pipeline.value;
		}

		const buildFlag: NewFlag = Object.assign(state);
		// Remove empty fields
		Object.keys(buildFlag).forEach((k) => buildFlag[k] == null && delete buildFlag[k]);

		try {
			const flag = await this.config.getApi().postFeatureFlag(this.config.getConfig().project, buildFlag);
			env.clipboard.writeText(flag.key);
			window.showInformationMessage(`Flag: ${flag.key} created and key copied to your clipboard.`);
			this.flag = flag;
		} catch (err) {
			window.showErrorMessage(`[LaunchDarkly] Creating flag ${err}`);
		}
	}
}

const keyRegexp = /^[\w\d][.A-Za-z_\-0-9]*$/u;
const capitalizedWordRegexp = /^[A-Z0-9][a-z0-9]*$/;
//const tagRegexp = /^[.A-Za-z_\-0-9]+$/;

export const convertToKey = (input: string) => {
	if (!keyRegexp.test(input)) {
		return kebabCase(input);
	} else if (capitalizedWordRegexp.test(input)) {
		return input.toLowerCase();
	}
	return input;
};

const isValidKey = async (v: string): Promise<string> => {
	if (keyRegexp.test(v)) {
		return '';
	} else {
		return "Invalid key. Keys must start with a letter or number and only contain letters, numbers, '.', '_' or '-'";
	}
};

// TODO: Implement valid name check
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isValidName = async (v: string): Promise<string> => {
	return '';
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isValidDescription = async (v: string): Promise<string> => {
	return '';
};
