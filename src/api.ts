import * as rp from 'request-promise-native';
import * as url from 'url';

import { Configuration } from './configuration';
import { Resource, Project, Environment, Flag } from './models';

// LaunchDarklyAPI is a wrapper around request-promise-native for requesting data from LaunchDarkly's REST API. The caller is expected to catch all exceptions.
export class LaunchDarklyAPI {
	private readonly config: Configuration;

	constructor(config: Configuration) {
		this.config = config;
	}

	async getAccount() {
		const options = this.createOptions('account');
		const account = await rp(options);
		return JSON.parse(account);
	}

	async getProjects(): Promise<Array<Project>> {
		const options = this.createOptions('projects');
		const data = await rp(options);
		const projects = JSON.parse(data).items;
		projects.forEach((proj: Project) => {
			proj.environments = proj.environments.sort(sortNameCaseInsensitive);
			return proj;
		});
		return projects.sort(sortNameCaseInsensitive);
	}

	async getEnvironment(projectKey: string, envKey: string): Promise<Environment> {
		const options = this.createOptions(`projects/${projectKey}/environments/${envKey}`);
		const data = await rp(options);
		return JSON.parse(data);
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

const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};
