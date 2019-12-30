import { WorkspaceConfiguration, workspace, ExtensionContext } from 'vscode';

export const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
export const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';

export class Configuration {
	private readonly ctx: ExtensionContext;

	constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
		this.reload();
	}

	reload() {
		let config: WorkspaceConfiguration = workspace.getConfiguration('launchdarkly');
		for (const option in this) {
			this[option] = config.get(option);
		}

		// If accessToken is configured in state, use it. Otherwise, fall back to the legacy access token.
		this.accessToken = this.getState('accessToken') || this.accessToken;
	}

	private getState(key: string): string {
		return this.ctx.workspaceState.get(key) || this.ctx.globalState.get(key);
	}

	accessToken = '';
	sdkKey = '';
	project = '';
	env = '';
	enableHover = true;
	enableAutocomplete = true;
	baseUri = DEFAULT_BASE_URI;
	streamUri = DEFAULT_STREAM_URI;
}
