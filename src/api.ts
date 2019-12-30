import * as rp from 'request-promise-native';
import * as url from 'url';

import { Configuration } from './configuration';
import { Flag } from './models';

// LaunchDarklyAPI is a wrapper around request-promise-native for requesting data from LaunchDarkly's REST API. The caller is expected to catch all exceptions.
export class LaunchDarklyAPI {
	config: Configuration

	constructor(config: Configuration) {
		this.config = config
	}

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string): Promise<Flag> {
		const envParam = envKey ? '?env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/${flagKey + envParam}`);
		const data = await rp(options);
		return JSON.parse(data);
	}

	private createOptions(path: string) {
		return {
			url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			headers: {
				Authorization: this.config.accessToken,
			},
		};
	}
}
