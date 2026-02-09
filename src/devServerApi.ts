import axios from 'axios';
import { ILDExtensionConfiguration } from './models';

export interface DevServerFlag {
	key: string;
	value: unknown;
	version: number;
	variation: number;
	trackEvents: boolean;
	trackReason: boolean;
}

export interface DevServerOverride {
	flagKey: string;
	value: unknown;
	isOverridden: boolean;
}

export interface DevServerProject {
	key: string;
	sourceEnvironmentKey: string;
	context: Record<string, unknown>;
	flagsState: Record<string, DevServerFlag>;
	lastSyncTime: string;
}

/**
 * API client for interacting with the LaunchDarkly CLI dev-server
 */
export class DevServerApi {
	private config: ILDExtensionConfiguration;

	constructor(config: ILDExtensionConfiguration) {
		this.config = config;
	}

	private getBaseUrl(): string {
		return this.config.getConfig().getDevServerUri();
	}

	private getProjectKey(): string {
		return this.config.getConfig().project;
	}

	/**
	 * Check if the dev-server is reachable
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const response = await axios.get(`${this.getBaseUrl()}/dev/projects`, {
				timeout: 2000,
			});
			return response.status === 200;
		} catch {
			return false;
		}
	}

	/**
	 * Get project information including all flags and their current values
	 */
	async getProject(): Promise<DevServerProject | null> {
		try {
			const response = await axios.get<DevServerProject>(
				`${this.getBaseUrl()}/dev/projects/${this.getProjectKey()}`,
				{ timeout: 5000 },
			);
			return response.data;
		} catch (err) {
			console.error(`Failed to get dev-server project: ${err}`);
			return null;
		}
	}

	/**
	 * Get all flags and their current values from the dev-server
	 */
	async getAllFlags(): Promise<Record<string, DevServerFlag> | null> {
		const project = await this.getProject();
		return project?.flagsState ?? null;
	}

	/**
	 * Get a specific flag's current value from the dev-server
	 */
	async getFlagValue(flagKey: string): Promise<DevServerFlag | null> {
		const flags = await this.getAllFlags();
		return flags?.[flagKey] ?? null;
	}

	/**
	 * Get all flag overrides
	 */
	async getOverrides(): Promise<Record<string, unknown> | null> {
		try {
			const response = await axios.get<Record<string, unknown>>(
				`${this.getBaseUrl()}/dev/projects/${this.getProjectKey()}/overrides`,
				{ timeout: 5000 },
			);
			return response.data;
		} catch (err) {
			// 404 means no overrides exist, which is fine
			if (axios.isAxiosError(err) && err.response?.status === 404) {
				return {};
			}
			console.error(`Failed to get dev-server overrides: ${err}`);
			return null;
		}
	}

	/**
	 * Set an override for a specific flag
	 */
	async setOverride(flagKey: string, value: unknown): Promise<boolean> {
		try {
			await axios.put(
				`${this.getBaseUrl()}/dev/projects/${this.getProjectKey()}/overrides/${flagKey}`,
				JSON.stringify(value),
				{
					headers: { 'Content-Type': 'application/json' },
					timeout: 5000,
				},
			);
			return true;
		} catch (err) {
			console.error(`Failed to set dev-server override: ${err}`);
			return false;
		}
	}

	/**
	 * Remove an override for a specific flag
	 */
	async removeOverride(flagKey: string): Promise<boolean> {
		try {
			await axios.delete(
				`${this.getBaseUrl()}/dev/projects/${this.getProjectKey()}/overrides/${flagKey}`,
				{ timeout: 5000 },
			);
			return true;
		} catch (err) {
			console.error(`Failed to remove dev-server override: ${err}`);
			return false;
		}
	}

	/**
	 * Sync the project from the source environment
	 */
	async syncProject(): Promise<boolean> {
		try {
			await axios.patch(
				`${this.getBaseUrl()}/dev/projects/${this.getProjectKey()}`,
				{},
				{
					headers: { 'Content-Type': 'application/json' },
					timeout: 30000,
				},
			);
			return true;
		} catch (err) {
			console.error(`Failed to sync dev-server project: ${err}`);
			return false;
		}
	}
}
