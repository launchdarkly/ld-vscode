import { WorkspaceConfiguration, workspace } from 'vscode';

export const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
export const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';

class Configuration {
	constructor() {
		this.reload();
	}

	reload() {
		let config: WorkspaceConfiguration = workspace.getConfiguration('launchdarkly');
		for (const option in this) {
			this[option] = config.get(option);
		}
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

export const configuration = new Configuration();
