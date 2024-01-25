import {
	ExtensionContext,
	ProgressLocation,
	QuickPick,
	QuickPickItem,
	QuickPickItemKind,
	authentication,
	window,
	workspace,
} from 'vscode';

import { MultiStepInput } from './multiStepInput';
import { LaunchDarklyAPI } from './api';
import { Resource, Project, Environment } from './models';
import { extensionReload, logDebugMessage } from './utils';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
interface CMState {
	baseUri: string;
	env: string;
	project: string;
}
export class ConfigurationMenu {
	private readonly config: LDExtensionConfiguration;
	private api: LaunchDarklyAPI;
	private readonly ctx: ExtensionContext;
	private title: string;
	private totalSteps: number;
	private projects: Array<Project>;
	private useGlobalState: boolean;
	private state: CMState;

	constructor(config: LDExtensionConfiguration) {
		this.config = config;
		this.api = config.getApi();
		this.title = 'Configure LaunchDarkly';
		this.totalSteps = 1;
		workspace.name && this.totalSteps++;
		this.ctx = config.getCtx();
	}

	async collectInputs(): Promise<CMState> {
		const state = {} as CMState;

		await MultiStepInput.run((input) => this.pickProject(input, state));

		return state;
	}

	shouldResume(): Promise<boolean> {
		// Required by multiStepInput
		// Could show a notification with the option to resume.
		//eslint-disable-next-line @typescript-eslint/no-empty-function
		return new Promise<boolean>(() => {});
	}

	async pickProject(input: MultiStepInput<QuickPickItem>, state: CMState) {
		const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
		if (session === undefined) {
			window
				.showInformationMessage(
					'You are not logged into LaunchDarkly. Please sign in to LaunchDarkly to continue.',
					'Sign In',
				)
				.then((selection) => {
					if (selection === 'Sign In') {
						authentication.getSession('launchdarkly', ['writer'], { createIfNone: true });
					}
				});
		}
		const projectOptions: QuickPickItem[] = [
			{ label: 'Retrieving projects...it may take a moment.', description: '', detail: '' },
		];

		try {
			this.api.getProjects().then((projects) => {
				this.projects = projects;
				const current = input.current as QuickPick<QuickPickItem>;
				current.items = projects.map(this.createQuickPickItem);
				input.current.busy = false;
			});
		} catch (err) {
			if (err.statusCode === 401) {
				//this.invalidAccessToken = state.accessToken;
				window.showErrorMessage('Invalid access token, please reconfigure your access token.');
				//return (input: MultiStepInput) => this.inputAccessToken(input, state);
			}
			throw err;
		}

		const pick = await input.showQuickPick({
			title: this.title,
			step: 1,
			totalSteps: this.totalSteps,
			placeholder: 'Select a project',
			items: projectOptions,
			activeItem: typeof state.project !== 'string' ? state.project : undefined,
			shouldResume: this.shouldResume,
			busy: true,
		});

		state.project = pick.description;
		return (input: MultiStepInput<QuickPickItem>) => this.pickEnvironment(input, state);
	}

	async pickEnvironment(input: MultiStepInput<QuickPickItem>, state: CMState) {
		const choices = [{ label: 'Retrieving environments...it may take a moment.', description: '', detail: '' }];
		const project = await this.config.getApi().getProject(state.project);
		logDebugMessage(`Environment picker project: ${state.project}`);
		logDebugMessage(`Environment project data: ${JSON.stringify(project)}`);
		const environments = project.environments.items;
		logDebugMessage(`Environment picker environments: ${environments}`);
		const envs = async () => {
			const selectEnvironmentOptions = environments
				.filter((item) => this.createEnvQuickPickItem(item))
				.map((item) => this.createQuickPickItem(item));
			logDebugMessage(`selectEnvironmentOptions: ${selectEnvironmentOptions}`);
			const cannotSelectEnvironmentOptions = environments
				.filter((item) => !this.createEnvQuickPickItem(item))
				.map((item) => this.createQuickPickItem(item));
			logDebugMessage(`cannotSelectEnvironmentOptions: ${cannotSelectEnvironmentOptions}`);
			const envSeparator = {
				label: 'These environments do not have their SDK Available to select. Configuration will fail.',
				kind: QuickPickItemKind.Separator,
			};
			return [...selectEnvironmentOptions, envSeparator, ...cannotSelectEnvironmentOptions];
		};

		envs().then((envs) => {
			const current = input.current as QuickPick<QuickPickItem>;
			current.items = envs;
		});

		const pick = await input.showQuickPick({
			title: this.title,
			step: 2,
			totalSteps: this.totalSteps,
			placeholder: 'Select an environment',
			items: choices,
			activeItem: typeof state.env !== 'string' ? state.env : undefined,
			shouldResume: this.shouldResume,
			matchOnDescription: true,
		});

		state.env = pick.description;
		pick.alwaysShow = false;
		this.state = state;
		window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: '[LaunchDarkly] Updating Configuration',
				cancellable: false,
			},
			() => {
				return new Promise((resolve) => {
					setTimeout(resolve, 3000);
				});
			},
		);
	}

	async validateAccessToken(token: string, invalidAccessToken: string) {
		if (token === invalidAccessToken) {
			return 'Invalid access token.';
		}
	}

	async configure() {
		await this.collectInputs();
		//const params = ['accessToken', 'baseUri', 'project', 'env'];
		const params = ['project', 'env'];
		for await (const option of params) {
			logDebugMessage(`Updating ${option} to ${this.state[option]}`);
			await this.config.getConfig().update(option, this.state[option], false);
		}
		// want menu to close while updating
		await extensionReload(this.config, true);
	}

	createQuickPickItem(resource: Resource): QuickPickItem {
		return {
			label: resource.name,
			description: resource.key,
			detail: resource.tags && resource.tags.length > 0 && `Tags: ${resource.tags.join(', ')}`,
		};
	}

	createEnvQuickPickItem(resource: Environment): number {
		if (resource.apiKey.includes('sdk-*')) {
			return 0;
		}
		return 1;
	}
}
