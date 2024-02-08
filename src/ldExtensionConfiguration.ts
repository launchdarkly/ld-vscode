import { ExtensionContext, StatusBarItem, TreeView } from 'vscode';
import {
	FlagStoreInterface,
	FlagTreeInterface,
	IConfiguration,
	IFlagAliases,
	ILaunchDarklyReleaseProvider,
	LaunchDarklyAPIInterface,
	LaunchDarklyAuthenticationSession,
	LaunchDarklyTreeViewProviderInterface,
} from './models';

export class LDExtensionConfiguration {
	private static instance: LDExtensionConfiguration;
	private config?: IConfiguration;
	private ctx: ExtensionContext;
	private api?: LaunchDarklyAPIInterface;
	private flagStore?: FlagStoreInterface;
	private flagTreeView: TreeView<FlagTreeInterface>;
	private flagView: LaunchDarklyTreeViewProviderInterface;
	private aliases?: IFlagAliases;
	private releaseView?: ILaunchDarklyReleaseProvider;
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

	getAliases(): IFlagAliases | undefined {
		return this.aliases;
	}

	setAliases(aliases: IFlagAliases): void {
		this.aliases = aliases;
	}

	getApi(): LaunchDarklyAPIInterface | undefined {
		return this.api;
	}

	setApi(api: LaunchDarklyAPIInterface): void {
		this.api = api;
	}

	getConfig(): IConfiguration | undefined {
		return this.config;
	}

	setConfig(config: IConfiguration): void {
		this.config = config;
	}

	getCtx(): ExtensionContext {
		return this.ctx;
	}

	setCtx(ctx: ExtensionContext): void {
		this.ctx = ctx;
	}

	getFlagStore(): FlagStoreInterface | undefined {
		return this.flagStore;
	}

	setFlagStore(flagStore: FlagStoreInterface): void {
		this.flagStore = flagStore;
	}

	getFlagTreeProvider(): TreeView<FlagTreeInterface> | undefined {
		return this.flagTreeView;
	}

	setFlagTreeProvider(flagTreeProvider: TreeView<FlagTreeInterface>): void {
		this.flagTreeView = flagTreeProvider;
	}

	getFlagView(): LaunchDarklyTreeViewProviderInterface | undefined {
		return this.flagView;
	}

	setFlagView(flagView: LaunchDarklyTreeViewProviderInterface): void {
		this.flagView = flagView;
	}

	getReleaseView(): ILaunchDarklyReleaseProvider | undefined {
		return this.releaseView;
	}

	setReleaseView(releaseView: ILaunchDarklyReleaseProvider): void {
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
