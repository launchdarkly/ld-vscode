import * as rp from 'request-promise-native';
import * as url from 'url';

import { Configuration } from './configuration';
import { Resource, Project, Environment, FeatureFlag } from './models';

const PACKAGE_JSON = require('../package.json');

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
		try {
			const options = this.createOptions(`projects/${projectKey}/environments/${envKey}`);
			const data = await rp(options);
			return JSON.parse(data);
		} catch (err) {
			return Promise.reject(this.errHandle(err));
		}
	}

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string): Promise<FeatureFlag> {
		try {
			const envParam = envKey ? '?env=' + envKey : '';
			const options = this.createOptions(`flags/${projectKey}/${flagKey + envParam}`);
			const data = await rp(options);
			return new FeatureFlag(JSON.parse(data));
		} catch (err) {
			return Promise.reject(this.errHandle(err));
		}
	}

	async getFeatureFlags(projectKey: string, envKey?: string): Promise<Array<FeatureFlag>> {
		try {
			const envParam = envKey ? 'env=' + envKey : '';
			const options = this.createOptions(`flags/${projectKey}/?${envParam}&summary=false&sort=name`);
			const data = await rp(options);
			const flags = JSON.parse(data).items;
			return flags;
		} catch (err) {
			return Promise.reject(this.errHandle(err));
		}
	}

	private errHandle(err): string {
		let message = 'Error retrieving Flags';
		if (err.statusCode === 401) {
			message = 'Unauthorized';
		} else if (err.statusCode === 404 || (err.statusCode === 400 && err.message.includes('Unknown environment key'))) {
			message = 'Configured environment does not exist.';
		}

		return message;
	}

	private createOptions(path: string, method: string = 'GET') {
		let options = {
			method: method,
			url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			headers: {
				Authorization: this.config.accessToken,
				UserAgent: 'VSCodeExtension/' + PACKAGE_JSON.version,
			},
		};

		return options;
	}
}

const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};
