import {
	WorkspaceConfiguration,
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	ConfigurationTarget,
	authentication,
} from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const package_json = require('../package.json');

const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';
const ACCESS_TOKEN = 'launchdarkly_accessToken';

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
		const baseUri = await this.getState('baseUri');

		// if (!accessToken) {
		// 	return;
		// }
		// if (!accessToken.startsWith('api')) {
		// 	console.error(`Access Token does not start with api-. token: ${accessToken}`);
		// 	window.showErrorMessage('[LaunchDarkly] Access Token does not start with api-. Please reconfigure.');
		// }
		//this.accessToken = accessToken;
		this.env = env as string;
		this.project = project as string;
		this.baseUri = baseUri === 'undefined' ? DEFAULT_BASE_URI : (baseUri as string);
	}

	async update(key: string, value: string | boolean, global: boolean): Promise<void> {
		if (typeof this[key] !== typeof value) {
			return;
		}
		const config: WorkspaceConfiguration = workspace.getConfiguration('launchdarkly');
		// if (key === 'accessToken') {
		// 	await this.ctx.secrets.store(ACCESS_TOKEN, value as string);
		// 	this[key] = value as string;
		// 	return;
		//} else
		if (key === 'env' || key === 'project' || key === 'baseUri') {
			const ctxState = this.ctx.workspaceState;
			await ctxState.update(key, value);
			this[key] = value as string;
			return;
		} else {
			await config.update(key, value, global);
		}

		this[key] = value;
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		process.nextTick(() => {});
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
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return true;
		}
		return false;
	}

	public streamingConfigStartCheck(): boolean {
		const streamingConfigOptions = ['baseUri', 'streamUri'];
		const currProj = this.ctx.workspaceState.get('project');
		const currEnv = this.ctx.workspaceState.get('env');
		if (
			!streamingConfigOptions.every((o) => !!this[o]) &&
			typeof currProj !== 'undefined' &&
			typeof currEnv !== 'undefined'
			//global.ldSession !== undefined
		) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return false;
		}
		return true;
	}

	async validate(): Promise<string> {
		const version = package_json.version;
		const ctx = this.ctx;
		ctx.globalState.update('version', undefined);
		const storedVersion = ctx.globalState.get('version');
		const isDisabledForWorkspace = ctx.workspaceState.get('isDisabledForWorkspace');

		if (version !== storedVersion) {
			ctx.globalState.update('version', version);
		}

		// Only recommend configuring the extension on install and update
		const checkConfig = await this.isConfigured();
		if (!isDisabledForWorkspace && version != storedVersion && !checkConfig) {
			return 'unconfigured';
		}
	}

	async isConfigured(): Promise<boolean> {
		//const token = await this.ctx.secrets.get(ACCESS_TOKEN);
		let proj = await this.ctx.workspaceState.get('project');
		if (typeof proj === 'undefined') {
			proj = '';
		}
		let env = await this.ctx.workspaceState.get('env');
		if (typeof env === 'undefined') {
			env = '';
		}
		// We need to check session here because the LDExtensionConfiguration is not yet initialized.
		const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
		const check = proj !== '' && env !== '' && session !== undefined;
		return check;
	}

	async localIsConfigured(): Promise<boolean> {
		const config = workspace.getConfiguration('launchdarkly');
		return (
			//!!(await this.ctx.secrets.get(ACCESS_TOKEN)) ||
			!!config.inspect('project').workspaceValue || !!config.inspect('env').workspaceValue
		);
	}

	async clearLocalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		//await this.ctx.workspaceState.update('accessToken', undefined);
		await config.update('project', undefined, ConfigurationTarget.Workspace);
		await config.update('env', undefined, ConfigurationTarget.Workspace);
		await this.ctx.workspaceState.update('project', undefined);
		await this.ctx.workspaceState.update('env', undefined);
	}

	async clearGlobalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		//await this.ctx.globalState.update('accessToken', undefined);
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
		const currValue = await this.ctx.workspaceState.get(key);
		if (typeof currValue === 'undefined') {
			const workDir = workspace.workspaceFolders[0];
			if (typeof workDir !== 'undefined') {
				const config = workspace.getConfiguration('launchdarkly', workspace.workspaceFolders[0]);
				const configValue = await config.get(key);
				if (configValue !== '') {
					// Updating Workspace from old config values, these could be workspace or global.
					await this.ctx.workspaceState.update(key, configValue);
					await config.update(key, undefined);
					return configValue;
				}
			}
			const globalConfig = workspace.getConfiguration('launchdarkly');
			const globalConfigValue = await globalConfig.get(key);
			if (globalConfigValue !== '') {
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
