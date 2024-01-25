import { ExtensionContext, TreeView } from 'vscode';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import { LaunchDarklyAuthenticationSession } from './providers/authProvider';
import { FlagTreeInterface, LaunchDarklyTreeViewProvider } from './providers/flagsView';

export class LDExtensionConfiguration {
	private static instance: LDExtensionConfiguration;
	private config?: Configuration;
	private ctx: ExtensionContext;
	private api?: LaunchDarklyAPI;
	private flagStore?: FlagStore;
	private flagTreeView: TreeView<FlagTreeInterface>;
	private flagView: LaunchDarklyTreeViewProvider;
	private aliases?: FlagAliases;
	private session?: LaunchDarklyAuthenticationSession;

	private constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
	}

	public static getInstance(ctx?: ExtensionContext): LDExtensionConfiguration {
		if (!LDExtensionConfiguration.instance) {
			LDExtensionConfiguration.instance = new LDExtensionConfiguration(ctx);
		}
		return LDExtensionConfiguration.instance;
	}

	public setConfig(config: Configuration): void {
		this.config = config;
	}

	public getConfig(): Configuration | undefined {
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

	public getApi(): LaunchDarklyAPI | undefined {
		return this.api;
	}

	public setFlagStore(flagStore: FlagStore): void {
		this.flagStore = flagStore;
	}

	public getFlagStore(): FlagStore | undefined {
		return this.flagStore;
	}

	public setFlagTreeProvider(flagTreeProvider: TreeView<FlagTreeInterface>): void {
		this.flagTreeView = flagTreeProvider;
	}

	public getFlagTreeProvider(): TreeView<FlagTreeInterface> | undefined {
		return this.flagTreeView;
	}

	public setFlagView(flagView: LaunchDarklyTreeViewProvider): void {
		this.flagView = flagView;
	}

	public getFlagView(): LaunchDarklyTreeViewProvider | undefined {
		return this.flagView;
	}

	public setAliases(aliases: FlagAliases): void {
		this.aliases = aliases;
	}

	public getAliases(): FlagAliases | undefined {
		return this.aliases;
	}

	public setSession(session: LaunchDarklyAuthenticationSession): void {
		this.session = session;
	}

	public getSession(): LaunchDarklyAuthenticationSession | undefined {
		return this.session;
	}
}
