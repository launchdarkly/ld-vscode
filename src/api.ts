import * as url from 'url';
import { authentication, commands, window } from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios').default;

import { Configuration } from './configuration';
import { FlagLink, InstructionPatch, NewFlag, ReleasePipeline } from './models';
import { Resource, Project, FeatureFlag, Environment, PatchOperation, PatchComment, Metric } from './models';
import { RepositoryRep } from 'launchdarkly-api-typescript';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
import { LaunchDarklyAuthenticationSession } from './providers/authProvider';
//import { FeatureFlag } from 'launchdarkly-api-typescript';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PACKAGE_JSON = require('../package.json');

interface CreateOptionsParams {
	method?: string;
	body?: PatchComment | unknown;
	params?: unknown;
	isArray?: boolean;
	sempatch?: boolean;
	beta?: boolean;
}

// LaunchDarklyAPI is a wrapper around request-promise-native for requesting data from LaunchDarkly's REST API. The caller is expected to catch all exceptions.
export class LaunchDarklyAPI {
	private readonly config: Configuration;
	private readonly ldConfig: LDExtensionConfiguration;

	constructor(config: Configuration, ldConfig: LDExtensionConfiguration) {
		this.config = config;
		this.ldConfig = ldConfig;
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
		if (!projectKey) {
			return;
		}
		try {
			const options = this.createOptions(`projects/${projectKey}`);
			const data = await axios.get(options.url, options);
			const project = data.data;
			return project;
		} catch (err) {
			window
				.showErrorMessage(
					`[LaunchDarkly] Error getting Project: ${projectKey}\n${err}`,
					'Configure LaunchDarkly Extension',
				)
				.then((selection) => {
					if (selection === 'Configure LaunchDarkly Extension')
						commands.executeCommand('extension.configureLaunchDarkly');
				});
		}
	}

	async getEnvironment(projectKey: string, envKey: string): Promise<Environment> {
		if (!projectKey || !envKey) {
			return;
		}
		try {
			const options = this.createOptions(`projects/${projectKey}/environments/${envKey}`);
			const data = await axios.get(options.url, options);
			return data.data;
		} catch (err) {
			window
				.showErrorMessage(
					`[LaunchDarkly] Error getting Project: ${projectKey} Environment: ${envKey}\n${err}`,
					'Configure LaunchDarkly Extension',
				)
				.then((selection) => {
					if (selection === 'Configure LaunchDarkly Extension')
						commands.executeCommand('extension.configureLaunchDarkly');
				});
		}
	}

	async getMetrics(projectKey: string): Promise<Array<Metric>> {
		try {
			// TODO: Update to use cursor and get all
			const options = this.createOptions(`metrics/${projectKey}?limit=50`);
			const data = await axios.get(options.url, options);
			return data.data.items;
		} catch (err) {
			window
				.showErrorMessage(
					`[LaunchDarkly] Error getting Metrics for Project: ${projectKey}\n${err}`,
					'Configure LaunchDarkly Extension',
				)
				.then((selection) => {
					if (selection === 'Configure LaunchDarkly Extension')
						commands.executeCommand('extension.configureLaunchDarkly');
				});
		}
	}

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string): Promise<FeatureFlag> {
		const envParam = envKey ? '?env=' + envKey : '';
		const options = this.createOptions(`flags/${projectKey}/${flagKey + envParam}`);
		const data = await axios.get(options.url, options);
		return new FeatureFlag(data.data);
	}

	async getFlagCodeRefs(projectKey: string, repo: string, flag?: string): Promise<Array<RepositoryRep>> {
		const flagKey = flag ? `&flagKey=${flag}` : '';
		const params = `?projKey=${projectKey}${flagKey}&withReferencesForDefaultBranch=1`;
		const options = this.createOptions(`code-refs/repositories${params}`);
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async getFlagLinks(projectKey: string, flag: string): Promise<Array<FlagLink>> {
		const options = this.createOptions(`flag-links/projects/${projectKey}/flags/${flag}`, { beta: true });
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async getReleasePipelines(projectKey: string): Promise<Array<ReleasePipeline>> {
		const options = this.createOptions(`projects/${projectKey}/release-pipelines`);
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async postFeatureFlag(projectKey: string, flag: NewFlag): Promise<FeatureFlag> {
		// We really only need options here for the headers and auth
		const options = this.createOptions(``, { method: 'POST' });
		const data = await axios.post(url.resolve(this.config.baseUri, `api/v2/flags/${projectKey}`), flag, options);
		return new FeatureFlag(data.data);
	}

	async getFeatureFlags(projectKey: string, envKey?: string, url?: string): Promise<Array<FeatureFlag>> {
		if (!projectKey) {
			return [];
		}
		const envParam = envKey ? 'env=' + envKey : '';
		const initialUrl = `flags/${projectKey}/?${envParam}&summary=true&sort=name&limit=50`;
		const requestUrl = url || initialUrl;
		const options = this.createOptions(requestUrl, { method: 'GET', params: envParam });
		let data;
		try {
			data = await this.executeWithRetry(() => axios.get(options.url, { ...options }), 2);
		} catch (err) {
			console.log(err);
			return [];
		}
		const flags = data.data.items;
		if (data.data._links && data.data._links.next) {
			// If there is a 'next' link, fetch the next page
			const match = '/api/v2/';
			const nextLink = data.data._links.next.href.replace(new RegExp(match), '');
			const moreFlags = await this.executeWithRetry(() => this.getFeatureFlags(projectKey, envKey, nextLink), 2);
			return flags.concat(moreFlags);
		} else {
			// If there is no 'next' link, all items have been fetched
			return flags;
		}
	}

	async patchFeatureFlag(projectKey: string, flagKey: string, value?: PatchComment): Promise<FeatureFlag | Error> {
		try {
			const options = this.createOptions(`flags/${projectKey}/${flagKey}`, {
				method: 'PATCH',
				body: value,
			});
			const data = await axios.patch(options.url, value, options);
			return new FeatureFlag(data);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	async patchFeatureFlagSem(
		projectKey: string,
		flagKey: string,
		value?: InstructionPatch,
	): Promise<FeatureFlag | Error> {
		try {
			const options = this.createOptions(`flags/${projectKey}/${flagKey}`, {
				method: 'PATCH',
				body: value,
				sempatch: true,
			});
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
			return this.executeWithRetry(() => this.patchFeatureFlag(projectKey, flagKey, patchOp), 2);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	private createOptions(
		path: string,
		{ method = 'GET', body, params, isArray, sempatch, beta }: CreateOptionsParams = {},
	) {
		const options = {
			method: method,
			//url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			url: url.resolve(this.config.baseUri, `api/v2/${path}`),
			params: null,
			headers: {
				//Authorization: `Bearer blah`,
				Authorization: `Bearer ${this.ldConfig.getSession().accessToken}`,
				'User-Agent': 'VSCodeExtension/' + PACKAGE_JSON.version,
				'LD-API-Version': beta ? 'beta' : 20191212,
			},
		};
		if (params) {
			options.params = params;
		}

		if (sempatch) {
			options.headers['content-type'] = 'application/json; domain-model=launchdarkly.semanticpatch';
		} else {
			options.headers['content-type'] = 'application/json';
		}
		if (body && isArray) {
			options['data'] = [JSON.stringify(body)];
		} else {
			options['data'] = JSON.stringify(body);
		}
		return options;
	}

	private async executeWithRetry<T>(func: () => Promise<T>, maxRetries= 2): Promise<T> {
		for (let i = 0; i < maxRetries; i++) {
			console.log("Trying request")
		    try {
			return await func();
		    } catch (error) {
			if (error.response && error.response.status === 401) {
			 console.log("Got 401, retrying")   
			    const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false }) as LaunchDarklyAuthenticationSession;
			    if (session) {
				this.ldConfig.setSession(session);
				console.log("Got session, retrying")
				return await func();
			    } else {
				console.log("Err1")
				throw error;
			    }
			} else {
				console.log("Err2")
			    throw error;
			}
		    }
		}
		throw new Error('Max retries exceeded');
	    }
}

export const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};
