import { ExtensionContext, StatusBarItem, TreeView } from 'vscode';
import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import { LaunchDarklyAuthenticationSession } from './providers/authProvider';
import { FlagTreeInterface, LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { LaunchDarklyReleaseProvider } from './providers/releaseViewProvider';

export class LDExtensionConfiguration {
	private static instance: LDExtensionConfiguration;
	private config?: Configuration;
	private ctx: ExtensionContext;
	private api?: LaunchDarklyAPI;
	private flagStore?: FlagStore;
	private flagTreeView: TreeView<FlagTreeInterface>;
	private flagView: LaunchDarklyTreeViewProvider;
	private aliases?: FlagAliases;
	private releaseView?: LaunchDarklyReleaseProvider;
	private session?: LaunchDarklyAuthenticationSession;
	private statusBar?: StatusBarItem;

	private constructor(ctx: ExtensionContext) {
		this.ctx = ctx;
	}

	static getInstance(ctx?: ExtensionContext): LDExtensionConfiguration {
		if (!LDExtensionConfiguration.instance) {
			LDExtensionConfiguration.instance = new LDExtensionConfiguration(ctx);
		}
		return LDExtensionConfiguration.instance;
	}

	getAliases(): FlagAliases | undefined {
		return this.aliases;
	}

	setAliases(aliases: FlagAliases): void {
		this.aliases = aliases;
	}

	getApi(): LaunchDarklyAPI | undefined {
		return this.api;
	}

	setApi(api: LaunchDarklyAPI): void {
		this.api = api;
	}

	getConfig(): Configuration | undefined {
		return this.config;
	}

	setConfig(config: Configuration): void {
		this.config = config;
	}

	getCtx(): ExtensionContext {
		return this.ctx;
	}

	setCtx(ctx: ExtensionContext): void {
		this.ctx = ctx;
	}

	getFlagStore(): FlagStore | undefined {
		return this.flagStore;
	}

	setFlagStore(flagStore: FlagStore): void {
		this.flagStore = flagStore;
	}

	getFlagTreeProvider(): TreeView<FlagTreeInterface> | undefined {
		return this.flagTreeView;
	}

	setFlagTreeProvider(flagTreeProvider: TreeView<FlagTreeInterface>): void {
		this.flagTreeView = flagTreeProvider;
	}

	getFlagView(): LaunchDarklyTreeViewProvider | undefined {
		return this.flagView;
	}

	setFlagView(flagView: LaunchDarklyTreeViewProvider): void {
		this.flagView = flagView;
	}

	getReleaseView(): LaunchDarklyReleaseProvider | undefined {
		return this.releaseView;
	}

	setReleaseView(releaseView: LaunchDarklyReleaseProvider): void {
		this.releaseView = releaseView;
	}

	getSession(): LaunchDarklyAuthenticationSession | undefined {
		return this.session;
	}

	setSession(session: LaunchDarklyAuthenticationSession): void {
		this.session = session;
	}

	getStatusBar(): StatusBarItem | undefined {
		return this.statusBar;
	}

	setStatusBar(statusBar: StatusBarItem): void {
		this.statusBar = statusBar;
	}
}
