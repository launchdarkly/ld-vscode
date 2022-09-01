import { reject } from 'lodash';
import * as url from 'url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios').default;

import { Configuration } from './configuration';
import { NewFlag } from './createFlagMenu';
import { Resource, Project, FeatureFlag, Environment, PatchOperation, PatchComment, Metric } from './models';
//import { FeatureFlag } from 'launchdarkly-api-typescript';
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
		const account = await axios.get(options.url, options);
		return account.data;
	}

	async getProjects(): Promise<Array<Project>> {
		const options = this.createOptions('projects');
		const data = await axios.get(options.url, options);
		const projects = data.data.items;
		projects.forEach((proj: Project) => {
			proj.environments = proj.environments.sort(sortNameCaseInsensitive);
			return proj;
		});
		return projects.sort(sortNameCaseInsensitive);
	}

	async getProject(projectKey: string): Promise<Project> {
		const options = this.createOptions(`projects/${projectKey}`);
		console.log(options);
		const data = await axios.get(options.url, options);
		console.log(data);
		const project = data.data;
		console.log(project);
		return project;
	}

	async getEnvironment(projectKey: string, envKey: string): Promise<Environment> {
		const options = this.createOptions(`projects/${projectKey}/environments/${envKey}`);
		const data = await axios.get(options.url, options);
		return data.data;
	}

	async getMetrics(projectKey: string): Promise<Array<Metric>> {
		// TODO: Update to use cursor and get all
		const options = this.createOptions(`metrics/${projectKey}?limit=50`);
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string): Promise<FeatureFlag> {
		const envParam = envKey ? '?env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/${flagKey + envParam}`);
		const data = await axios.get(options.url, options);
		return new FeatureFlag(data.data);
	}

	async postFeatureFlag(projectKey: string, flag: NewFlag): Promise<FeatureFlag> {
		// We really only need options here for the headers and auth
		const options = this.createOptions(``, 'POST');
		const data = await axios.post(url.resolve(this.config.baseUri, `api/v2/flags/${projectKey}`), flag, options);
		return new FeatureFlag(data.data);
	}

	async getFeatureFlags(projectKey: string, envKey?: string): Promise<Array<FeatureFlag>> {
		const envParam = envKey ? 'env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/?${envParam}&summary=true&sort=name`, 'GET', null, {
			envParam,
			summary: true,
			sort: 'name',
		});
		let data;
		try {
			data = await axios.get(options.url, options);
		} catch (err) {
			console.log(err);
			reject([]);
		}
		const flags = data.data.items;
		return flags;
	}

	async patchFeatureFlag(projectKey: string, flagKey: string, value?: PatchComment): Promise<FeatureFlag | Error> {
		try {
			const options = this.createOptions(`flags/${projectKey}/${flagKey}`, 'PATCH', value);
			const data = await axios.patch(options.url, value, options);
			return new FeatureFlag(data);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	async patchFeatureFlagOn(projectKey: string, flagKey: string, enabled: boolean): Promise<FeatureFlag | Error> {
		try {
			const patch = new PatchOperation();
			patch.path = `/environments/${this.config.env}/on`;
			patch.op = 'replace';
			patch.value = enabled;
			const patchOp = new PatchComment();
			patchOp.comment = 'VS Code Updated';
			patchOp.patch = [patch];
			return this.patchFeatureFlag(projectKey, flagKey, patchOp);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	private createOptions(
		path: string,
		method = 'GET',
		body?: PatchComment | unknown,
		params?: unknown,
		isArray?: boolean,
	) {
		const options = {
			method: method,
			url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			params: null,
			headers: {
				Authorization: this.config.accessToken,
				'User-Agent': 'VSCodeExtension/' + PACKAGE_JSON.version,
				'LD-API-Version': 20191212
			},
		};

		if (params) {
			options.params = params;
		}

		if (body && isArray) {
			options.headers['content-type'] = 'application/json';
			options['data'] = [JSON.stringify(body)];
		} else {
			options.headers['content-type'] = 'application/json';
			options['data'] = JSON.stringify(body);
		}
		return options;
	}
}

export const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};
