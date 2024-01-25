import {
	WorkspaceConfiguration,
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	ConfigurationTarget,
	authentication,
} from 'vscode';
import { logDebugMessage } from './utils';

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
		//const accessToken = await this.ctx.secrets.get(ACCESS_TOKEN);
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

	// public streamingConfigStartCheck(): boolean {
	// 	const streamingConfigOptions = ['baseUri', 'streamUri'];
	// 	const currProj = this.ctx.workspaceState.get('project');
	// 	const currEnv = this.ctx.workspaceState.get('env');
	// 	if (
	// 		!streamingConfigOptions.every((o) => !!this[o]) &&
	// 		typeof currProj === 'undefined' &&
	// 		typeof currEnv === 'undefined'
	// 		//global.ldSession !== undefined
	// 	) {
	// 		logDebugMessage(`Streaming config start check failed. Project: ${currProj} Environment: ${currEnv}`);
	// 		console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
	// 		return false;
	// 	}
	// 	return true;
	// }

	async validate(): Promise<string> {
		const version = this.ctx.extension.packageJSON.version;
		const ctx = this.ctx;
		const storedVersion = ctx.globalState.get('version');
		// Moving this update under the get version and awaiting it.
		//await ctx.globalState.update('version', undefined);
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
				if (this.ctx.workspaceState.get('isDisabledForWorkspace') !== undefined) {
					proj = await this.ctx.globalState.get('project');
					env = await this.ctx.globalState.get('env');
				}
				logDebugMessage(`Global Autoload values, Project: ${proj} Environment: ${env}`);
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

	// async localIsConfigured(): Promise<boolean> {
	// 	const config = workspace.getConfiguration('launchdarkly');
	// 	return (
	// 		//!!(await this.ctx.secrets.get(ACCESS_TOKEN)) ||
	// 		!!config.inspect('project').workspaceValue || !!config.inspect('env').workspaceValue
	// 	);
	// }

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
		await this.ctx.secrets.delete(ACCESS_TOKEN);
		await this.reload();
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

	async getState(key: string): Promise<string | unknown> {
		const globalAutoload = workspace.getConfiguration('launchdarkly').get('globalDefault') as GlobalDefault;
		let currValue: string | undefined;
		switch (globalAutoload) {
			case GlobalDefault.NoGlobalAutoload:
				currValue = await this.ctx.globalState.get(key);
				break;
			case GlobalDefault.GlobalAutoload:
				currValue = await this.ctx.globalState.get(key);
				break;
			case GlobalDefault.Off:
				currValue = await this.ctx.workspaceState.get(key);
				break;
		}
		//const currValue = await this.ctx.workspaceState.get(key);
		if (typeof currValue === 'undefined') {
			const workDir = workspace.workspaceFolders[0];
			if (typeof workDir !== 'undefined') {
				const config = workspace.getConfiguration('launchdarkly', workspace.workspaceFolders[0]);
				const configValue = await config.get(key);
				if (configValue !== '' || configValue !== undefined) {
					// Updating Workspace from old config values, these could be workspace or global.
					await this.ctx.workspaceState.update(key, configValue);
					await config.update(key, undefined);
					return configValue;
				}
			}
			const globalConfig = workspace.getConfiguration('launchdarkly');
			const globalConfigValue = await globalConfig.get(key);
			if (globalConfigValue !== '' || globalConfigValue !== undefined) {
				// Updating Workspace from old config values, these could be workspace or global.
				await this.ctx.workspaceState.update(key, globalConfigValue);
				await globalConfig.update(key, undefined);
				return globalConfigValue;
			}
		} else {
			return currValue;
		}
	}

	validateRefreshInterval(interval: number): boolean {
		return 0 <= interval && interval <= 1440;
	}
}
