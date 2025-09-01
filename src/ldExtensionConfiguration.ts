import { ExtensionContext, StatusBarItem, TreeView } from 'vscode';
import { DebuggerHandler } from './utils/debugger';
import { QuickLinksListProvider } from './providers/quickLinksView';
import {
	IFlagStore,
	IFlagTree,
	IConfiguration,
	IFlagAliases,
	ILaunchDarklyReleaseProvider,
	LaunchDarklyAPIInterface,
	ILaunchDarklyAuthenticationSession,
	ILaunchDarklyTreeViewProvider,
	Environment,
} from './models';

export class LDExtensionConfiguration {
	private static instance: LDExtensionConfiguration;
	private config?: IConfiguration;
	private ctx: ExtensionContext;
	private api?: LaunchDarklyAPIInterface;
	private flagStore?: IFlagStore;
	private flagTreeView: TreeView<IFlagTree>;
	private flagView: ILaunchDarklyTreeViewProvider;
	private aliases?: IFlagAliases;
	private releaseView?: ILaunchDarklyReleaseProvider;
	private session?: ILaunchDarklyAuthenticationSession;
	private statusBar?: StatusBarItem;
	private quickLinksProvider?: QuickLinksListProvider;
	private debugHandler?: DebuggerHandler;
	private environment?: Environment;
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

	getFlagStore(): IFlagStore | undefined {
		return this.flagStore;
	}

	setFlagStore(flagStore: IFlagStore): void {
		this.flagStore = flagStore;
	}

	getFlagTreeProvider(): TreeView<IFlagTree> | undefined {
		return this.flagTreeView;
	}

	setFlagTreeProvider(flagTreeProvider: TreeView<IFlagTree>): void {
		this.flagTreeView = flagTreeProvider;
	}

	getFlagView(): ILaunchDarklyTreeViewProvider | undefined {
		return this.flagView;
	}

	setFlagView(flagView: ILaunchDarklyTreeViewProvider): void {
		this.flagView = flagView;
	}

	getReleaseView(): ILaunchDarklyReleaseProvider | undefined {
		return this.releaseView;
	}

	setReleaseView(releaseView: ILaunchDarklyReleaseProvider): void {
		this.releaseView = releaseView;
	}

	getSession(): ILaunchDarklyAuthenticationSession | undefined {
		return this.session;
	}

	setSession(session: ILaunchDarklyAuthenticationSession): void {
		this.session = session;
	}

	getStatusBar(): StatusBarItem | undefined {
		return this.statusBar;
	}

	setStatusBar(statusBar: StatusBarItem): void {
		this.statusBar = statusBar;
	}

	getQuickLinksProvider(): QuickLinksListProvider | undefined {
		return this.quickLinksProvider;
	}

	setQuickLinksProvider(quickLinksProvider: QuickLinksListProvider): void {
		this.quickLinksProvider = quickLinksProvider;
	}

	getDebugHandler(): DebuggerHandler | undefined {
		return this.debugHandler;
	}
	
	setDebugHandler(debugHandler: DebuggerHandler): void {
		this.debugHandler = debugHandler;
	}

	getEnvironment(): Environment | undefined {
		return this.environment;
	}

	setEnvironment(environment: Environment): void {
		this.environment = environment;
	}
}