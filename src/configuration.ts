import {
	WorkspaceConfiguration,
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	ConfigurationTarget,
	authentication,
} from 'vscode';
import { logDebugMessage } from './utils/logDebugMessage';
import { YamlReader } from './utils/yamlReader';
import path from 'path';

import * as vscode from 'vscode';
import { StaleConfig } from './models';
const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';
const ACCESS_TOKEN = 'launchdarkly_accessToken';

enum GlobalDefault {
	NoGlobalAutoload = 'use global defaults (no autoload)',
	GlobalAutoload = 'use global defaults (autoload)',
	Off = 'off',
}

type refreshRateConfig = {
	flags: number;
	codeRefs: number;
};
export class Configuration {
	private readonly ctx: ExtensionContext;

	project = '';
	env = '';
	accessToken = '';
	codeRefsPath = '';
	refreshRate = 120;
	codeRefsRefreshRate = 240;
	enableAliases = true;
	enableHover = true;
	enableAutocomplete = true;
	enableFlagExplorer = true;
	enableMetricExplorer = false;
	enableCodeLens = false;
	enableStaleFlagCheck = false;
	baseUri = DEFAULT_BASE_URI;
	streamUri = DEFAULT_STREAM_URI;

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
	}

	async reload(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		for (const option in this) {
			if (option === 'ctx' || option === 'project' || option === 'env' || option === 'accessToken') {
				continue;
			}
			this[option] = config.get(option);
		}
		const { flags, codeRefs } = workspace.getConfiguration('launchdarkly').get('refreshRate') as refreshRateConfig;
		this.refreshRate = flags;
		this.codeRefsRefreshRate = codeRefs;
		// If accessToken is configured in state, use it. Otherwise, fall back to the legacy access token.
		const oldToken = await this.ctx.globalState.get('accessToken');
		// Delete the old token once it's in new secrets API.
		if (oldToken) {
			await this.ctx.secrets.store(ACCESS_TOKEN, oldToken as string);
			await this.ctx.globalState.update('accessToken', null);
			await this.ctx.workspaceState.update('accessToken', null);
		}
		let env = await this.getState('env');
		if (typeof env === 'undefined') {
			env = '';
		}
		let project = await this.getState('project');
		if (typeof project === 'undefined') {
			project = '';
		}

		this.env = env as string;
		this.project = project as string;
	}

	async update(key: string, value: string | boolean, global: boolean): Promise<void> {
		if (typeof this[key] !== typeof value) {
			return;
		}
		const config: WorkspaceConfiguration = workspace.getConfiguration('launchdarkly');

		try {
			if (key === 'env' || key === 'project') {
				const ctxState = this.ctx.workspaceState;
				await ctxState.update(key, value);
				this[key] = value as string;
				return;
			} else {
				await config.update(key, value, global);
			}
		} catch (err) {
			console.log(err);
		}

		this[key] = value;
	}

	public streamingConfigReloadCheck(e: ConfigurationChangeEvent): boolean {
		const streamingConfigOptions = ['baseUri', 'streamUri'];
		const currProj = this.ctx.workspaceState.get('project');
		const currEnv = this.ctx.workspaceState.get('env');
		if (
			streamingConfigOptions.every((option) => !e.affectsConfiguration(`launchdarkly.${option}`)) &&
			typeof currProj !== 'undefined' &&
			typeof currEnv !== 'undefined'
		) {
			logDebugMessage('Streaming config reload check failed.');
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return true;
		}
		return false;
	}

	async validate(): Promise<string> {
		const version = this.ctx.extension.packageJSON.version;
		const ctx = this.ctx;
		const storedVersion = ctx.globalState.get('version');
		// Moving this update under the get version and awaiting it.
		const isDisabledForWorkspace = ctx.workspaceState.get('isDisabledForWorkspace');

		if (version !== storedVersion) {
			await ctx.globalState.update('version', version);
		}

		// Only recommend configuring the extension on install and update
		const checkConfig = await this.isConfigured();
		if (isDisabledForWorkspace) {
			logDebugMessage("LD is Disabled for this workspace, don't show the prompt");
			logDebugMessage(`isDisabledForWorkspace: ${isDisabledForWorkspace}`);
			return 'unconfigured';
		}
		if (!checkConfig) {
			logDebugMessage(
				`Validate: unconfigured, version match: ${version === storedVersion} checkConfig: ${checkConfig}`,
			);
			logDebugMessage(`Current Version: ${version} Stored Version: ${storedVersion}`);
			return 'unconfigured';
		}
		return '';
	}

	async isConfigured(): Promise<boolean> {
		let proj, env: string | undefined;
		const globalAutoload = workspace.getConfiguration('launchdarkly').get('globalDefault', 'off') as GlobalDefault;
		switch (globalAutoload) {
			// `isDisabledWorkspace` is already checked for true before this function is called.
			case GlobalDefault.NoGlobalAutoload:
				if (this.ctx.workspaceState.get('isDisabledForWorkspace') === false) {
					proj = await this.ctx.globalState.get('project');
					env = await this.ctx.globalState.get('env');
				}
				logDebugMessage(`Global NoAutoload values, Project: ${proj} Environment: ${env}`);
				break;
			case GlobalDefault.GlobalAutoload:
				proj = await this.ctx.globalState.get('project');
				env = await this.ctx.globalState.get('env');
				logDebugMessage(`Global Autoload values, Project: ${proj} Environment: ${env}`);
				break;
			case GlobalDefault.Off:
				// global defaults will be overridden by project specific below anyway.
				break;
		}

		proj = await this.ctx.workspaceState.get('project', proj);
		if (typeof proj === 'undefined') {
			proj = '';
		}
		env = await this.ctx.workspaceState.get('env', env);
		if (typeof env === 'undefined') {
			env = '';
		}
		// We need to check session here because the LDExtensionConfiguration is not yet initialized.
		const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
		logDebugMessage(`isConfigured Project: ${proj} Environment: ${env} Session: ${session !== undefined}`);
		const check = proj !== '' && env !== '' && session !== undefined;
		return check;
	}

	async getStaleConfig() {
		let config;
		const defaultConfig: StaleConfig = {
			checkRulesInCriticalEnvs: true,
			days: 21,
			skipCriticalEnvironmentsCheck: false,
			skipReleasePipelinesCheck: true,
		};
		const workspaceRoot = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;

		if (workspaceRoot) {
			config = YamlReader.read(path.join(workspaceRoot, '.launchdarkly', 'staleConfig.yaml'), null, false);
		}

		return { ...defaultConfig, ...config };
	}

	async clearLocalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		await config.update('project', undefined, ConfigurationTarget.Workspace);
		await config.update('env', undefined, ConfigurationTarget.Workspace);
		await this.ctx.workspaceState.update('project', undefined);
		await this.ctx.workspaceState.update('env', undefined);
	}

	async clearGlobalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		await config.update('project', undefined, ConfigurationTarget.Global);
		await config.update('env', undefined, ConfigurationTarget.Global);
	}

	async copyWorkspaceToGlobal(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		await this.ctx.globalState.update('project', config.get('project'));
		await this.ctx.globalState.update('env', config.get('env'));
	}

	async setGlobalDefault(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		const currentGlobal = await config.get('globalDefault');
		const swapCurrent = !currentGlobal;
		await config.update('globalDefault', swapCurrent);
		if (swapCurrent) {
			await this.copyWorkspaceToGlobal();
		}
	}

	getEnvs() {
		const criticalEnvs = this.ctx.workspaceState.get('criticalEnvs') as Array<string>;
		const returnEnvs = [this.env];
		if (criticalEnvs) {
			returnEnvs.push(...criticalEnvs);
		}
		return returnEnvs;
	}

	async getState(key: string): Promise<string | unknown> {
		const globalAutoload = workspace.getConfiguration('launchdarkly').get('globalDefault') as GlobalDefault;
		let currValue: string | undefined;
		if (globalAutoload == GlobalDefault.NoGlobalAutoload || globalAutoload == GlobalDefault.GlobalAutoload) {
			currValue = await this.ctx.globalState.get(key);
		}

		currValue = await this.ctx.workspaceState.get(key);

		if (typeof currValue !== 'undefined') {
			return currValue;
		}
		const workDir = workspace.workspaceFolders?.[0];
		if (typeof workDir === 'undefined') {
			return;
		} else {
			const config = workspace.getConfiguration('launchdarkly', workspace.workspaceFolders[0]);
			const configValue = await config.get(key);
			if (configValue !== '' && configValue !== undefined) {
				// Updating Workspace from old config values, these could be workspace or global.
				await this.ctx.workspaceState.update(key, configValue);
				await config.update(key, undefined);
				return configValue;
			}
		}
		const globalConfig = workspace.getConfiguration('launchdarkly');
		const globalConfigValue = await globalConfig.get(key);
		if (globalConfigValue !== '' && globalConfigValue !== undefined) {
			// Updating Workspace from old config values, these could be workspace or global.
			await this.ctx.workspaceState.update(key, globalConfigValue);
			await globalConfig.update(key, undefined);
			return globalConfigValue;
		}
	}

	validateRefreshInterval(interval: number): boolean {
		return 0 <= interval && interval <= 1440;
	}
}

export async function clearGlobalConfig() {
	const config = workspace.getConfiguration('launchdarkly');
	await config.update('project', undefined, ConfigurationTarget.Global);
	await config.update('env', undefined, ConfigurationTarget.Global);
}
