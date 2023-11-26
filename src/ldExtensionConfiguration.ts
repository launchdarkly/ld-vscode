import { ExtensionContext } from 'vscode';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import { LaunchDarklyAuthenticationSession } from './providers/authProvider';

export class LDExtensionConfiguration {
	private static instance: LDExtensionConfiguration;
	private config?: Configuration;
	private ctx: ExtensionContext;
	private api?: LaunchDarklyAPI;
	private flagStore?: FlagStore;
	private aliases?: FlagAliases;
	private session?: LaunchDarklyAuthenticationSession;

	private constructor(
		ctx: ExtensionContext,
	) {
		this.ctx = ctx;
	}

	public static getInstance(
		ctx?: ExtensionContext,
	): LDExtensionConfiguration {
		if (!LDExtensionConfiguration.instance) {
			LDExtensionConfiguration.instance = new LDExtensionConfiguration(ctx);
		}
		return LDExtensionConfiguration.instance;
	}

	public setConfig(config: Configuration): void {
		this.config = config;
	}

	public getConfig(): Configuration | null {
		return this.config;
	}

	public setCtx(ctx: ExtensionContext): void {
		this.ctx = ctx;
	}

	public getCtx(): ExtensionContext {
		return this.ctx;
	}

	public setApi(api: LaunchDarklyAPI): void {
		this.api = api;
	}

	public getApi(): LaunchDarklyAPI | null {
		return this.api;
	}

	public setFlagStore(flagStore: FlagStore): void {
		this.flagStore = flagStore;
	}

	public getFlagStore(): FlagStore | null {
		return this.flagStore;
	}

	public setAliases(aliases: FlagAliases): void {
		this.aliases = aliases;
	}

	public getAliases(): FlagAliases | null {
		return this.aliases;
	}

	public setSession(session: LaunchDarklyAuthenticationSession): void {
		this.session = session
	}

	public getSession(): LaunchDarklyAuthenticationSession | null {
		return this.session;
	}
}
