import {
	WorkspaceConfiguration,
	workspace,
	ExtensionContext,
	ConfigurationChangeEvent,
	ConfigurationTarget,
	window,
} from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const package_json = require('../package.json');

const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';

export class Configuration {
	private readonly ctx: ExtensionContext;
	accessToken = '';
	sdkKey = '';
	project = '';
	env = '';
	codeRefsPath = '';
	refreshRate = 120;
	codeRefsRefreshRate = 240;
	enableAliases = true;
	enableHover = true;
	enableAutocomplete = true;
	enableFlagExplorer = true;
	baseUri = DEFAULT_BASE_URI;
	streamUri = DEFAULT_STREAM_URI;

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
		this.reload();
	}

	reload(): void {
		const config = workspace.getConfiguration('launchdarkly');
		for (const option in this) {
			if (option === 'ctx') {
				continue;
			}
			this[option] = config.get(option);
		}

		// If accessToken is configured in state, use it. Otherwise, fall back to the legacy access token.
		const accessToken = this.getState('accessToken') || this.accessToken;
		if (!this.getState('env')) {
			this.ctx.workspaceState.update('env', this.env);
		}
		const env = this.getState('env');

		if (!this.getState('project')) {
			this.ctx.workspaceState.update('project', this.project);
		}
		const project = this.getState('project');

		if (!this.getState('baseUri')) {
			this.ctx.workspaceState.update('baseUri', this.baseUri);
		}
		const baseUri = this.getState('baseUri');

		if (!accessToken) {
			return
		}
		if (!accessToken.startsWith('api')) {
			console.error(`Access Token does not start with api-. token: ${accessToken}`);
			window.showErrorMessage('[LaunchDarkly] Access Token does not start with api-. Please reconfigure.');
		}
		this.accessToken = accessToken;
		this.env = env;
		this.project = project;
		this.baseUri = baseUri;
	}

	async update(key: string, value: string | boolean, global: boolean): Promise<void> {
		if (typeof this[key] !== typeof value) {
			return;
		}

		const config: WorkspaceConfiguration = workspace.getConfiguration('launchdarkly');
		if (key === 'accessToken') {
			const ctxState = this.ctx.globalState;
			await ctxState.update(key, value);
			return;
		} else if (
			key === 'env' ||
			key === 'project' ||
			key === 'baseUri'
		) {
			const ctxState = this.ctx.workspaceState;
			await ctxState.update(key, value);
			return;
		} else {
			await config.update(key, value, global);
		}

		this[key] = value;
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		process.nextTick(() => {});
	}

	public streamingConfigReloadCheck(e: ConfigurationChangeEvent): boolean {
		const streamingConfigOptions = ['accessToken', 'baseUri', 'streamUri', 'project', 'env'];
		if (streamingConfigOptions.every((option) => !e.affectsConfiguration(`launchdarkly.${option}`))) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return true;
		}
		return false;
	}

	public streamingConfigStartCheck(): boolean {
		const streamingConfigOptions = ['accessToken', 'baseUri', 'streamUri', 'project', 'env'];
		if (!streamingConfigOptions.every((o) => !!this[o])) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return false;
		}
		return true;
	}

	validate(): string {
		const version = package_json.version;
		const ctx = this.ctx;
		ctx.globalState.update('version', undefined);
		const storedVersion = ctx.globalState.get('version');
		const isDisabledForWorkspace = ctx.workspaceState.get('isDisabledForWorkspace');

		if (version !== storedVersion) {
			ctx.globalState.update('version', version);
		}

		// Only recommend configuring the extension on install and update
		if (!isDisabledForWorkspace && version != storedVersion && !this.isConfigured()) {
			return 'unconfigured';
		}
	}

	isConfigured(): boolean {
		return !!this.accessToken && !!this.project && !!this.env;
	}

	localIsConfigured(): boolean {
		const config = workspace.getConfiguration('launchdarkly');
		return (
			!!this.ctx.workspaceState.get('accessToken') ||
			!!config.inspect('project').workspaceValue ||
			!!config.inspect('env').workspaceValue
		);
	}

	async clearLocalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		await this.ctx.workspaceState.update('accessToken', undefined);
		await config.update('project', undefined, ConfigurationTarget.Workspace);
		await config.update('env', undefined, ConfigurationTarget.Workspace);
	}

	async clearGlobalConfig(): Promise<void> {
		const config = workspace.getConfiguration('launchdarkly');
		await this.ctx.globalState.update('accessToken', undefined);
		await config.update('project', undefined, ConfigurationTarget.Global);
		await config.update('env', undefined, ConfigurationTarget.Global);
	}

	getState(key: string): string {
		return this.ctx.workspaceState.get(key) || this.ctx.globalState.get(key);
	}

	validateRefreshInterval(interval: number): boolean {
		return 0 <= interval && interval <= 1440;
	}
}
