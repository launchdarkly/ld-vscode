import { ExtensionContext, QuickPickItem, window, workspace } from 'vscode';

import { MultiStepInput } from './multiStepInput';
import { LaunchDarklyAPI } from './api';
import { Resource, Project } from './models';
import { Configuration } from './configuration';
import { extensionReload } from './utils';
interface CMState {
	accessToken: string;
	baseUri: string;
	env: string;
	project: string;
}
export class ConfigurationMenu {
	private readonly config: Configuration;
	private api: LaunchDarklyAPI;
	private readonly ctx: ExtensionContext;
	private title: string;
	private totalSteps: number;
	private currentAccessToken: string;
	private projects: Array<Project>;
	private useGlobalState: boolean;
	private invalidAccessToken: string;
	private state: CMState;

	constructor(config: Configuration, api: LaunchDarklyAPI, ctx: ExtensionContext) {
		this.config = config;
		this.api = api;
		this.title = 'Configure LaunchDarkly';
		this.totalSteps = 3;
		workspace.name && this.totalSteps++;
		this.currentAccessToken = config.accessToken;
		this.ctx = ctx;
	}

	async collectInputs() {
		const state = {} as Partial<CMState>;
		if (this.currentAccessToken) {
			await MultiStepInput.run((input) => this.pickInstance(input, state));
			return;
		}

		await MultiStepInput.run((input) => this.pickInstance(input, state));
	}

	shouldResume(): Promise<boolean> {
		// Required by multiStepInput
		// Could show a notification with the option to resume.
		//eslint-disable-next-line @typescript-eslint/no-empty-function
		return new Promise<boolean>(() => {});
	}

	async pickCurrentOrNewAccessToken(input: MultiStepInput, state: Partial<CMState>) {
		this.useGlobalState = false;
		const existingTokenName = 'Use the existing access token';
		const clearOverrides = 'Clear Workspace Specific Configurations';
		const clearGlobalOverrides = 'Clear All LaunchDarkly Configurations';
		const options = [
			{ name: existingTokenName, key: 'xxxx' + this.currentAccessToken.substr(this.currentAccessToken.length - 6) },
			{ name: 'Enter a new access token' },
		];
		if (this.config.localIsConfigured()) {
			options.push({ name: clearOverrides, key: 'clear overrides' });
		}
		options.push({ name: clearGlobalOverrides, key: 'clear all configuration data' });

		const selectionOptions = options.map(this.createQuickPickItem);

		const pick = await input.showQuickPick({
			title: this.title,
			step: 1,
			totalSteps: this.totalSteps,
			placeholder: 'Use your existing LaunchDarkly access token, or enter a new one.',
			items: selectionOptions,
			shouldResume: this.shouldResume,
		});

		if (pick.label === existingTokenName) {
			state.accessToken = this.currentAccessToken;
			this.invalidAccessToken = '';
			return (input: MultiStepInput) => this.pickProject(input, state);
		}

		if (pick.label === clearOverrides) {
			await this.config.clearLocalConfig();
			this.config.reload();
			return (input: MultiStepInput) => this.pickInstance(input, state);
		}

		if (pick.label === clearGlobalOverrides) {
			await this.config.clearLocalConfig();
			await this.config.clearGlobalConfig();
			return (input: MultiStepInput) => this.pickInstance(input, state);
		}

		return (input: MultiStepInput) => this.inputAccessToken(input, state);
	}

	async inputAccessToken(input: MultiStepInput, state: Partial<CMState>) {
		state.accessToken = '';
		state.accessToken = await input.showInputBox({
			title: this.title,
			step: 1,
			totalSteps: this.totalSteps,
			value: typeof state.accessToken === 'string' ? state.accessToken : '',
			prompt: 'Enter your LaunchDarkly access token',
			validate: (token) => this.validateAccessToken(token, this.invalidAccessToken),
			shouldResume: this.shouldResume,
		});

		try {
			this.updateAPI(state);
			await this.api.getAccount();

			return (input: MultiStepInput) => this.pickProject(input, state);
		} catch (err) {
			if (err.statusCode === 401) {
				this.invalidAccessToken = state.accessToken;
				window.showErrorMessage('Invalid access token, please try again.');
				return (input: MultiStepInput) => this.inputAccessToken(input, state);
			}
			throw err;
		}
	}

	async pickInstance(input: MultiStepInput, state: Partial<CMState>) {
		const baseUri = await input.showInputBox({
			title: this.title,
			step: 1,
			value: this.config.baseUri,
			prompt: 'Enter LaunchDarkly Instance URL',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => this.validateAccessToken(token, this.invalidAccessToken),
		});

		state.baseUri = baseUri;
		return (input: MultiStepInput) => this.pickCurrentOrNewAccessToken(input, state);
	}

	async pickProject(input: MultiStepInput, state: Partial<CMState>) {
		let projectOptions: QuickPickItem[];
		try {
			this.updateAPI(state);
			const projects = await this.api.getProjects();
			this.projects = projects;
			projectOptions = projects.map(this.createQuickPickItem);
		} catch (err) {
			if (err.statusCode === 401) {
				this.invalidAccessToken = state.accessToken;
				window.showErrorMessage('Invalid access token, please reconfigure your access token.');
				return (input: MultiStepInput) => this.inputAccessToken(input, state);
			}
			throw err;
		}

		const pick = await input.showQuickPick({
			title: this.title,
			step: 3,
			totalSteps: this.totalSteps,
			placeholder: 'Select a project',
			items: projectOptions,
			activeItem: typeof state.project !== 'string' ? state.project : undefined,
			shouldResume: this.shouldResume,
		});

		state.project = pick.description;
		return (input: MultiStepInput) => this.pickEnvironment(input, state);
	}

	async pickEnvironment(input: MultiStepInput, state: Partial<CMState>) {
		const selectedProject = this.projects.find((proj) => proj.key === state.project);
		const environments = selectedProject.environments;
		const environmentOptions = environments.map(this.createQuickPickItem);

		const pick = await input.showQuickPick({
			title: this.title,
			step: 4,
			totalSteps: this.totalSteps,
			placeholder: 'Select an environment',
			items: environmentOptions,
			activeItem: typeof state.env !== 'string' ? state.env : undefined,
			shouldResume: this.shouldResume,
		});

		state.env = pick.description;
		Object.keys(state).forEach(async (key) => {
			await this.config.update(key, state[key], false);
		});
		extensionReload(this.config, this.ctx);
	}

	async validateAccessToken(token: string, invalidAccessToken: string) {
		if (token === invalidAccessToken) {
			return 'Invalid access token.';
		}
	}

	updateAPI(state: Partial<CMState>) {
		const configWithUpdatedToken = Object.assign({}, this.config);
		configWithUpdatedToken.accessToken = state.accessToken;
		configWithUpdatedToken.baseUri = state.baseUri;
		this.api = new LaunchDarklyAPI(configWithUpdatedToken);
	}

	async configure() {
		await this.collectInputs();
		['accessToken', 'baseUri', 'project', 'env'].forEach(async (option) => {
			await this.config.update(option, this[option], this.useGlobalState);
		});
	}

	createQuickPickItem(resource: Resource): QuickPickItem {
		return {
			label: resource.name,
			description: resource.key,
			detail: resource.tags && resource.tags.length > 0 && `Tags: ${resource.tags.join(', ')}`,
		};
	}
}
