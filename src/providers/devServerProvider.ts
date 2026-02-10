import { EventEmitter } from 'vscode';
import { ILDExtensionConfiguration } from '../models';
import { DevServerApi, DevServerFlag, DevServerOverrideInfo, DevServerProject } from '../devServerApi';

/**
 * Cached flag info combining flag state and override status
 */
export interface CachedFlagInfo {
	flag: DevServerFlag;
	isOverridden: boolean;
	override?: DevServerOverrideInfo;
}

/**
 * Provider that manages dev-server state and caches flag/override information
 */
export class DevServerProvider {
	private config: ILDExtensionConfiguration;
	private api: DevServerApi;
	private cachedProject: DevServerProject | null = null;
	private cachedFlags: Map<string, CachedFlagInfo> = new Map();
	private lastRefresh: Date | null = null;

	// Event emitters for state changes
	public readonly onDidRefresh: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidConnect: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidDisconnect: EventEmitter<void> = new EventEmitter<void>();

	constructor(config: ILDExtensionConfiguration) {
		this.config = config;
		this.api = new DevServerApi(config);
	}

	/**
	 * Get the underlying API client
	 */
	getApi(): DevServerApi {
		return this.api;
	}

	/**
	 * Check if connected to dev-server
	 */
	isConnected(): boolean {
		return this.config.getConfig().isDevServerEnabled();
	}

	/**
	 * Refresh the cached data from the dev-server
	 */
	async refresh(): Promise<boolean> {
		if (!this.isConnected()) {
			this.clearCache();
			return false;
		}

		try {
			const project = await this.api.getProject();
			if (!project) {
				return false;
			}

			this.cachedProject = project;
			this.buildFlagCache(project);
			this.lastRefresh = new Date();
			this.onDidRefresh.fire();
			return true;
		} catch (err) {
			console.error(`Failed to refresh dev-server data: ${err}`);
			return false;
		}
	}

	/**
	 * Build the flag cache from project data
	 */
	private buildFlagCache(project: DevServerProject): void {
		this.cachedFlags.clear();

		const overrides = project.overrides ?? {};

		for (const [flagKey, flag] of Object.entries(project.flagsState)) {
			const override = overrides[flagKey];
			this.cachedFlags.set(flagKey, {
				flag,
				isOverridden: override !== undefined,
				override,
			});
		}
	}

	/**
	 * Clear all cached data
	 */
	clearCache(): void {
		this.cachedProject = null;
		this.cachedFlags.clear();
		this.lastRefresh = null;
	}

	/**
	 * Get the cached project info
	 */
	getProject(): DevServerProject | null {
		return this.cachedProject;
	}

	/**
	 * Get all cached flags
	 */
	getAllFlags(): Map<string, CachedFlagInfo> {
		return this.cachedFlags;
	}

	/**
	 * Get all flags as a record (for compatibility)
	 */
	getFlagsRecord(): Record<string, DevServerFlag> | null {
		if (this.cachedFlags.size === 0) {
			return null;
		}
		const record: Record<string, DevServerFlag> = {};
		for (const [key, info] of this.cachedFlags) {
			record[key] = info.flag;
		}
		return record;
	}

	/**
	 * Get info for a specific flag
	 */
	getFlag(flagKey: string): CachedFlagInfo | undefined {
		return this.cachedFlags.get(flagKey);
	}

	/**
	 * Get the value of a specific flag
	 */
	getFlagValue(flagKey: string): unknown | undefined {
		return this.cachedFlags.get(flagKey)?.flag.value;
	}

	/**
	 * Check if a flag is overridden
	 */
	isOverridden(flagKey: string): boolean {
		return this.cachedFlags.get(flagKey)?.isOverridden ?? false;
	}

	/**
	 * Get all overridden flag keys
	 */
	getOverriddenFlags(): string[] {
		const overridden: string[] = [];
		for (const [key, info] of this.cachedFlags) {
			if (info.isOverridden) {
				overridden.push(key);
			}
		}
		return overridden;
	}

	/**
	 * Get the last refresh time
	 */
	getLastRefreshTime(): Date | null {
		return this.lastRefresh;
	}

	/**
	 * Set an override for a flag and refresh cache
	 */
	async setOverride(flagKey: string, value: unknown): Promise<boolean> {
		const success = await this.api.setOverride(flagKey, value);
		if (success) {
			await this.refresh();
		}
		return success;
	}

	/**
	 * Remove an override for a flag and refresh cache
	 */
	async removeOverride(flagKey: string): Promise<boolean> {
		const success = await this.api.removeOverride(flagKey);
		if (success) {
			await this.refresh();
		}
		return success;
	}

	/**
	 * Sync the project from source environment and refresh cache
	 */
	async syncProject(): Promise<boolean> {
		const success = await this.api.syncProject();
		if (success) {
			await this.refresh();
		}
		return success;
	}
}
