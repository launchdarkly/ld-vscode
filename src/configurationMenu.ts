import { QuickPickItem, window, workspace } from 'vscode';

import { MultiStepInput } from './multiStepInput';
import { LaunchDarklyAPI } from './api';
import { Resource, Project } from './models';
import { Configuration } from './configuration';
const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
export class ConfigurationMenu {
	private readonly config: Configuration;
	private api: LaunchDarklyAPI;
	private title: string;
	private totalSteps: number;
	private currentAccessToken: string;
	private accessToken: string;
	private projects: Array<Project>;
	private project: string;
	private env: string;
	private useGlobalState: boolean;
	private invalidAccessToken: string;
	private baseUri = DEFAULT_BASE_URI;
	private debugCipher: string;
	private debugChannel: string;

	constructor(config: Configuration, api: LaunchDarklyAPI) {
		this.config = config;
		this.api = api;
		this.title = 'Configure LaunchDarkly';
		this.totalSteps = 3;
		workspace.name && this.totalSteps++;
		this.currentAccessToken = config.accessToken;
	}

	async collectInputs() {
		if (this.currentAccessToken) {
			await MultiStepInput.run((input) => this.pickInstance(input));
			return;
		}

		await MultiStepInput.run((input) => this.pickInstance(input));
	}

	shouldResume(): Promise<boolean> {
		// Required by multiStepInput
		// Could show a notification with the option to resume.
		//eslint-disable-next-line @typescript-eslint/no-empty-function
		return new Promise<boolean>(() => {});
	}

	async pickCurrentOrNewAccessToken(input: MultiStepInput) {
		this.useGlobalState = false;
		const existingTokenName = 'Use the existing access token';
		const clearOverrides = 'Clear Workspace Specific Configurations';
		const clearGlobalOverrides = 'Clear All LaunchDarkly Configurations';
		const options = [
			{ name: 'Enter a new access token' },
			{ name: existingTokenName, key: 'xxxx' + this.currentAccessToken.substr(this.currentAccessToken.length - 6) },
		];
		if (this.config.localIsConfigured()) {
			options.push({ name: clearOverrides, key: 'clear overrides' });
		}
		options.push({ name: clearGlobalOverrides, key: 'clear all config data' });

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
			this.accessToken = this.currentAccessToken;
			this.invalidAccessToken = '';
			return (input: MultiStepInput) => this.pickProject(input);
		}

		if (pick.label === clearOverrides) {
			await this.config.clearLocalConfig();
			this.config.reload();
			return (input: MultiStepInput) => this.pickInstance(input);
		}

		if (pick.label === clearGlobalOverrides) {
			await this.config.clearLocalConfig();
			await this.config.clearGlobalConfig();
			return (input: MultiStepInput) => this.pickInstance(input);
		}

		return (input: MultiStepInput) => this.inputAccessToken(input);
	}

	async inputAccessToken(input: MultiStepInput) {
		this.accessToken = '';
		this.accessToken = await input.showInputBox({
			title: this.title,
			step: 1,
			totalSteps: this.totalSteps,
			value: typeof this.accessToken === 'string' ? this.accessToken : '',
			prompt: 'Enter your LaunchDarkly access token',
			validate: (token) => this.validateAccessToken(token, this.invalidAccessToken),
			shouldResume: this.shouldResume,
		});

		try {
			this.updateAPI();
			await this.api.getAccount();

			return (input: MultiStepInput) => this.pickProject(input);
		} catch (err) {
			if (err.statusCode === 401) {
				this.invalidAccessToken = this.accessToken;
				window.showErrorMessage('Invalid access token, please try again.');
				return (input: MultiStepInput) => this.inputAccessToken(input);
			}
			throw err;
		}
	}

	async pickInstance(input: MultiStepInput) {
		this.baseUri = await input.showInputBox({
			title: this.title,
			step: 1,
			value: this.config.baseUri,
			prompt: 'Enter LaunchDarkly Instance URL',
			totalSteps: this.totalSteps,
			shouldResume: this.shouldResume,
			validate: (token) => this.validateAccessToken(token, this.invalidAccessToken),
		});

		return (input: MultiStepInput) => this.pickCurrentOrNewAccessToken(input);
	}

	async pickProject(input: MultiStepInput) {
		let projectOptions: QuickPickItem[];
		try {
			this.updateAPI();
			const projects = await this.api.getProjects();
			this.projects = projects;
			projectOptions = projects.map(this.createQuickPickItem);
		} catch (err) {
			if (err.statusCode === 401) {
				this.invalidAccessToken = this.accessToken;
				window.showErrorMessage('Invalid access token, please reconfigure your access token.');
				return (input: MultiStepInput) => this.inputAccessToken(input);
			}
			throw err;
		}

		const pick = await input.showQuickPick({
			title: this.title,
			step: 3,
			totalSteps: this.totalSteps,
			placeholder: 'Select a project',
			items: projectOptions,
			activeItem: typeof this.project !== 'string' ? this.project : undefined,
			shouldResume: this.shouldResume,
		});

		this.project = pick.description;
		return (input: MultiStepInput) => this.pickEnvironment(input);
	}

	async pickEnvironment(input: MultiStepInput) {
		const selectedProject = this.projects.find((proj) => proj.key === this.project);
		const environments = selectedProject.environments;
		const environmentOptions = environments.map(this.createQuickPickItem);

		const pick = await input.showQuickPick({
			title: this.title,
			step: 4,
			totalSteps: this.totalSteps,
			placeholder: 'Select an environment',
			items: environmentOptions,
			activeItem: typeof this.env !== 'string' ? this.env : undefined,
			shouldResume: this.shouldResume,
		});

		this.env = pick.description;
		environments.map((env) => {
			if (env.key == pick.description) {
				this.debugCipher = env._pubnub.cipherKey;
				this.debugChannel = env._pubnub.channel;
			}
		});
	}

	async pickStorageType(input: MultiStepInput) {
		const allWorkspacesName = 'All workspaces';
		const storageOptions = [
			{ name: allWorkspacesName, key: 'Workspace-specific configurations will take precedence' },
			{ name: 'This workspace', key: workspace.name },
		].map(this.createQuickPickItem);

		const pick = await input.showQuickPick({
			title: this.title,
			step: 2,
			totalSteps: this.totalSteps,
			placeholder: 'Pick a configuration type',
			items: storageOptions,
			shouldResume: this.shouldResume,
		});

		this.useGlobalState = pick.label == allWorkspacesName ? true : false;
		return (input: MultiStepInput) => this.pickProject(input);
	}

	async validateAccessToken(token: string, invalidAccessToken: string) {
		if (token === invalidAccessToken) {
			return 'Invalid access token.';
		}
	}

	updateAPI() {
		const configWithUpdatedToken = Object.assign({}, this.config);
		configWithUpdatedToken.accessToken = this.accessToken;
		configWithUpdatedToken.baseUri = this.baseUri;
		this.api = new LaunchDarklyAPI(configWithUpdatedToken);
	}

	async configure() {
		await this.collectInputs();
		['accessToken', 'baseUri', 'project', 'env', 'debugCipher', 'debugChannel'].forEach(async (option) => {
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
