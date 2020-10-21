import * as rp from 'request-promise-native';
import * as url from 'url';

import { Configuration } from './configuration';
import { Resource, Project, Environment, FeatureFlag, PatchOperation, PatchComment } from './models';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PACKAGE_JSON = require('../package.json');

// LaunchDarklyAPI is a wrapper around request-promise-native for requesting data from LaunchDarkly's REST API. The caller is expected to catch all exceptions.
export class LaunchDarklyAPI {
	private readonly config: Configuration;

	constructor(config: Configuration) {
		this.config = config;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async getAccount(): Promise<any> {
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

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string): Promise<FeatureFlag> {
		const envParam = envKey ? '?env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/${flagKey + envParam}`);
		const data = await rp(options);
		return new FeatureFlag(JSON.parse(data));
	}

	async getFeatureFlags(projectKey: string, envKey?: string): Promise<Array<FeatureFlag>> {
		const envParam = envKey ? 'env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/?${envParam}&summary=true&sort=name`);
		const data = await rp(options);
		const flags = JSON.parse(data).items;
		return flags;
	}

	async patchFeatureFlag(projectKey: string, flagKey: string, value?: PatchComment): Promise<FeatureFlag> {
		const options = this.createOptions(`flags/${projectKey}/${flagKey}`, 'PATCH', value);
		const data = await rp(options);
		return new FeatureFlag(JSON.parse(data));
	}

	async patchFeatureFlagOn(projectKey: string, flagKey: string, enabled: boolean): Promise<FeatureFlag> {
		const patch = new PatchOperation();
		patch.path = `/environments/${this.config.env}/on`;
		patch.op = 'replace';
		patch.value = enabled;
		const patchOp = new PatchComment();
		patchOp.comment = 'VS Code Updated';
		patchOp.patch = [patch];
		return this.patchFeatureFlag(projectKey, flagKey, patchOp);
	}

	private createOptions(path: string, method = 'GET', body?: PatchComment) {
		const options = {
			method: method,
			url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			headers: {
				Authorization: this.config.accessToken,
				UserAgent: 'VSCodeExtension/' + PACKAGE_JSON.version,
			},
		};

		if (body) {
			options.headers['content-type'] = 'application/json';
			options['body'] = [JSON.stringify(body)];
		}

		return options;
	}
}

const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};
