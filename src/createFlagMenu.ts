import { env, window, workspace } from 'vscode';

import { MultiStepInput } from './multiStepInput';
import { LaunchDarklyAPI } from './api';
import { Configuration } from './configuration';
import { kebabCase } from 'lodash';
import { NewFlag } from './models';
export interface State {
	name: string;
	key: string;
	description: string;
	tags: string[];
	kind: string;
	clientAvailability: string;
	mobileAvailability: string;
	temporary: boolean;
}

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
export class CreateFlagMenu {
	private readonly config: Configuration;
	private api: LaunchDarklyAPI;
	private title: string;
	private totalSteps: number;

	constructor(config: Configuration, api: LaunchDarklyAPI) {
		this.config = config;
		this.api = api;
		this.title = 'Create Feature Flag';
		this.totalSteps = 2;
		workspace.name && this.totalSteps++;
	}

	async collectInputs() {
		const state = {} as Partial<State>;
		await MultiStepInput.run((input) => this.setFlagName(input, state));
	}

	shouldResume(): Promise<boolean> {
		// Required by multiStepInput
		// Could show a notification with the option to resume.
		//eslint-disable-next-line @typescript-eslint/no-empty-function
		return new Promise<boolean>(() => {});
	}

	async setFlagName(input: MultiStepInput, state: Partial<State>) {
		const name = await input.showInputBox({
			title: this.title,
			step: 1,
			value: '',
			prompt: 'Enter Flag Name',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => isValidName(token),
		});
		state.name = name;
		return (input: MultiStepInput) => this.setFlagKey(input, state);
	}

	async setFlagKey(input: MultiStepInput, state: Partial<State>) {
		const key = await input.showInputBox({
			title: this.title,
			step: 2,
			value: convertToKey(state.name),
			prompt: 'Enter Flag Key',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => isValidKey(token),
		});
		state.key = key;
		return (input: MultiStepInput) => this.setAvailability(input, state);
	}

	async setAvailability(input: MultiStepInput, state: Partial<State>) {
		const enableServer = 'Only make flag available on Server';
		const enableClient = 'Enable Client Side';
		const enableMobile = 'Enable Mobile Side';
		const enableBoth = 'Enable Both Mobile and Client';

		const availability = await input.showQuickPick({
			title: this.title,
			step: 3,
			items: [{ label: enableServer }, { label: enableClient }, { label: enableMobile }, { label: enableBoth }],
			placeholder: 'Select Client-side Availability',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
		});

		const flagAvailability = {
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

		const buildFlag: NewFlag = Object.assign(state);
		buildFlag['clientSideAvailability'] = flagAvailability;
		// Remove empty fields
		Object.keys(buildFlag).forEach((k) => buildFlag[k] == null && delete buildFlag[k]);

		try {
			const flag = await this.api.postFeatureFlag(this.config.project, buildFlag);
			env.clipboard.writeText(flag.key);
			window.showInformationMessage(`Flag: ${flag.key} created and key copied to your clipboard.`);
		} catch (err) {
			window.showErrorMessage(`[LaunchDarkly] Creating flag ${err}`);
		}
	}
}

const keyRegexp = /^[\w\d][.A-Za-z_\-0-9]*$/u;
const capitalizedWordRegexp = /^[A-Z0-9][a-z0-9]*$/;
const tagRegexp = /^[.A-Za-z_\-0-9]+$/;

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

const isValidTags = async (v: string): Promise<string> => {
	const tags = v.split(',').filter((i) => i);
	for (const tag of tags) {
		if (!tagRegexp.test(tag)) {
			return `Tag: ${tag} is invalid it must contain only letters, number, '.', '_' or '-'`;
		}
	}

	return '';
};
