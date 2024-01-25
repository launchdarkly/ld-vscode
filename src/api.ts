import * as url from 'url';
import { authentication, commands, window } from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios').default;
import axiosRetry from 'axios-retry';
import retry from 'axios-retry-after';

import { Configuration } from './configuration';
import { FlagLink, InstructionPatch, NewFlag, ProjectAPI, ReleasePhase, ReleasePipeline } from './models';
import { Resource, Project, FeatureFlag, Environment, PatchOperation, PatchComment, Metric } from './models';
import { RepositoryRep } from 'launchdarkly-api-typescript';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
import { LaunchDarklyAuthenticationSession } from './providers/authProvider';
import { debuglog } from 'util';
import { legacyAuth } from './utils';

interface CreateOptionsParams {
	method?: string;
	body?: PatchComment | unknown;
	params?: unknown;
	isArray?: boolean;
	sempatch?: boolean;
	beta?: boolean;
}

// Response interceptor for API calls
axios.interceptors.response.use(
	(response) => {
		return response;
	},
	async function (error) {
		const originalRequest = error.config;
		if (error.response.status === 404) {
			debuglog(error);
			debuglog(`404 for URL: ${originalRequest.url}`);
		}
		if (error.response.status === 401 && !originalRequest._retry) {
			const config = LDExtensionConfiguration.getInstance();
			originalRequest._retry = true;
			const session = (await authentication.getSession('launchdarkly', ['writer'], {
				createIfNone: false,
			})) as LaunchDarklyAuthenticationSession;
			config.setSession(session);
			originalRequest.headers['Authorization'] = `Bearer ${session.accessToken}`;
			return axios(originalRequest);
		}
		return Promise.reject(error);
	},
);

axios.interceptors.response.use(
	null,
	retry(axios, {
		isRetryable(error) {
			return (
				error.response &&
				error.response.status === 429 &&
				error.response.headers['X-Ratelimit-Reset'] &&
				error.response.headers['X-Ratelimit-Reset'] <= 60
			);
		},

		// Customize the wait behavior
		wait(error) {
			return new Promise((resolve) => setTimeout(resolve, error.response.headers['X-Ratelimit-Reset']));
		},

		// Customize the retry request itself
		retry(axios, error) {
			if (!error.config) {
				throw error;
			}

			// Apply request customizations before retrying
			// ...

			return axios(error.config);
		},
	}),
);

axiosRetry(axios, { retries: 2, retryDelay: axiosRetry.exponentialDelay });

// LaunchDarklyAPI is a wrapper around request-promise-native for requesting data from LaunchDarkly's REST API. The caller is expected to catch all exceptions.
export class LaunchDarklyAPI {
	private readonly config: Configuration;
	private readonly ldConfig: LDExtensionConfiguration;

	constructor(config: Configuration, ldConfig: LDExtensionConfiguration) {
		this.config = config;
		this.ldConfig = ldConfig;
	}

	async getProjects(url?: string): Promise<Array<Project>> {
		//const options = this.createOptions('projects');
		const limit = 100;
		const initialUrl = `projects?sort=name&limit=${limit}`;
		const requestUrl = url || initialUrl;
		const options = this.createOptions(requestUrl, { method: 'GET' });
		let data;

		try {
			//data = await this.executeWithRetry(() => axios.get(options.url, { ...options }), 2);
			data = await axios.get(options.url, { ...options });
		} catch (err) {
			console.log(err);
			return [];
		}
		const projects = data.data.items;
		if (data.data._links && data.data._links.next) {
			// If there is a 'next' link, fetch the next page
			const match = '/api/v2/';
			const nextLink = data.data._links.next.href.replace(new RegExp(match), '');
			const moreProjects = await this.getProjects(`${nextLink}`);
			return projects.concat(moreProjects);
		} else {
			// If there is no 'next' link, all items have been fetched
			return projects;
		}

		// const data = await axios.get(options.url, options);

		// const projects = data.data.items;
		// projects.forEach((proj: Project) => {
		// 	proj.environments = proj.environments.sort(sortNameCaseInsensitive);
		// 	return proj;
		// });
		// return projects.sort(sortNameCaseInsensitive);
	}

	async getProject(projectKey: string, url?: string): Promise<ProjectAPI | undefined> {
		try {
			const initialUrl = `projects/${projectKey}?expand=environments`;
			const requestUrl = url || initialUrl;
			const options = this.createOptions(requestUrl, { method: 'GET' });
			const data = await axios.get(options.url, { ...options });
			const project = data.data;

			if (project.environments._links && project.environments._links.next) {
				const match = '/api/v2/';
				const nextLink = project.environments._links.next.href.replace(new RegExp(match), '');
				const moreEnvs = await this.getEnvironments(nextLink);
				project.environments.items = project.environments.items.concat(moreEnvs);
			}

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

	async getEnvironments(url): Promise<Array<Environment>> {
		try {
			const requestUrl = url;
			const options = this.createOptions(requestUrl, { method: 'GET' });
			const data = await axios.get(options.url, options);
			const environments = data.data.items;

			if (data.data._links && data.data._links.next) {
				// If there is a 'next' link, fetch the next page
				const match = '/api/v2/';
				const nextLink = data.data._links.next.href.replace(new RegExp(match), '');
				const moreEnvs = await this.getEnvironments(nextLink);
				return environments.concat(moreEnvs);
			} else {
				// If there is no 'next' link, all items have been fetched
				return environments;
			}
		} catch (err) {
			console.log(err);
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
			console.log(err);
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

	async getFeatureFlag(projectKey: string, flagKey: string, envKey?: string, fullFlag?: boolean): Promise<FeatureFlag> {
		const envParam = envKey ? 'env=' + envKey : '';
		const summaryParam = fullFlag ? 'summary=false' : '';
		const params = envParam || summaryParam ? `?${envParam}${summaryParam ? `&${summaryParam}` : ''}` : '';
		const options = this.createOptions(`flags/${projectKey}/${flagKey + params}`);
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
		const options = this.createOptions(`projects/${projectKey}/release-pipelines`, { beta: true });
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async getReleases(projectKey: string, pipelineKey: string, pipelineId: string): Promise<Array<ReleasePhase>> {
		const options = this.createOptions(
			`projects/${projectKey}/release-pipelines/${pipelineKey}/releases?filter=status+equals+"active",activePhaseId+equals+"${pipelineId}"`,
			{ beta: true },
		);
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async getCompletedReleases(projectKey: string, pipelineKey: string): Promise<Array<ReleasePhase>> {
		const options = this.createOptions(
			`projects/${projectKey}/release-pipelines/${pipelineKey}/releases?filter=status+equals+"completed"`,
			{ beta: true },
		);
		const data = await axios.get(options.url, options);
		return data.data.items;
	}

	async postFeatureFlag(projectKey: string, flag: NewFlag): Promise<FeatureFlag> {
		// We really only need options here for the headers and auth
		const options = this.createOptions(``, { method: 'POST' });
		const data = await axios.post(
			url.resolve(this.ldConfig.getSession().fullUri, `api/v2/flags/${projectKey}`),
			flag,
			options,
		);
		return new FeatureFlag(data.data);
	}

	async getFeatureFlags(projectKey: string, envKey?: string, url?: string): Promise<Array<FeatureFlag>> {
		if (!projectKey) {
			return [];
		}
		const envParam = envKey ? 'env=' + envKey : '';
		const limit = 100;
		const initialUrl = `flags/${projectKey}/?${envParam}&summary=true&sort=name&limit=${limit}`;
		const requestUrl = url || initialUrl;
		const options = this.createOptions(requestUrl, { method: 'GET', params: envParam });
		let data;

		try {
			//data = await this.executeWithRetry(() => axios.get(options.url, { ...options }), 2);
			data = await axios.get(options.url, { ...options });
		} catch (err) {
			console.log(err);
			return [];
		}
		const flags = data.data.items;
		if (data.data._links && data.data._links.next) {
			// If there is a 'next' link, fetch the next page
			const match = '/api/v2/';
			const nextLink = data.data._links.next.href.replace(new RegExp(match), '');
			//await sleep(1500);
			//const moreFlags = await this.executeWithRetry(async () => await this.getFeatureFlags(projectKey, envKey, nextLink), 2);
			const moreFlags = await this.getFeatureFlags(projectKey, envKey, nextLink);
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
			return new FeatureFlag(data.data);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	async patchFeatureFlagOn(projectKey: string, flagKey: string, enabled: boolean): Promise<FeatureFlag | Error> {
		try {
			const patch = new PatchOperation();
			patch.path = `/environments/${this.ldConfig.getConfig().env}/on`;
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

	private createOptions(
		path: string,
		{ method = 'GET', body, params, isArray, sempatch, beta }: CreateOptionsParams = {},
	) {
		const apiToken = legacyAuth()
			? this.ldConfig.getSession()?.accessToken
			: `Bearer ${this.ldConfig.getSession()?.accessToken}`;
		const hostPath = `${this.ldConfig.getSession()?.fullUri}/api/v2/${path}`;
		const options = {
			method: method,
			url: hostPath,
			headers: {
				Authorization: apiToken,
				'User-Agent': 'VSCodeExtension/' + this.ldConfig.getCtx().extension.packageJSON.version,
				'LD-API-Version': beta ? 'beta' : '20220603',
			},
		};
		if (params) {
			options['params'] = params;
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
}

export const sortNameCaseInsensitive = (a: Resource, b: Resource) => {
	return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};

// async function sleep(ms) {
// 	const sleepMs = Math.random() * 500 + ms;
// 	return new Promise((resolve) => setTimeout(resolve, sleepMs));
// }
