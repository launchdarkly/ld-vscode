import { commands, Disposable, DocumentFilter, ExtensionContext, languages, window } from 'vscode';
import { LaunchDarklyAPI } from './api';
import generalCommands from './commands/generalCommands';
import { Configuration } from './configuration';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import LaunchDarklyCompletionItemProvider from './providers/completion';
import { FlagCodeLensProvider } from './providers/flagLens';
import { LaunchDarklyFlagListProvider } from './providers/flagListView';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { LaunchDarklyHoverProvider } from './providers/hover';
import { LaunchDarklyMetricsTreeViewProvider } from './providers/metricsView';
import { QuickLinksListProvider } from './providers/quickLinksView';

export default async function checkExistingCommand(commandName: string): Promise<boolean> {
	const checkCommands = await commands.getCommands(false);
	if (checkCommands.includes(commandName)) {
		return true;
	}
	return false;
}

export function extensionReload(config: Configuration, ctx: ExtensionContext) {
	// Read in latest version of config
	config.reload();
	const newApi = new LaunchDarklyAPI(config);
	const flagStore = new FlagStore(config, newApi);
	setupComponents(newApi, config, ctx, flagStore);
}

export function setupComponents(
	api: LaunchDarklyAPI,
	config: Configuration,
	ctx: ExtensionContext,
	flagStore: FlagStore,
) {
	const cmds = ctx.globalState.get<Disposable>('commands');
	if (typeof cmds?.dispose === 'function') {
		cmds.dispose();
	}

	// Add metrics view
	const metricsView = new LaunchDarklyMetricsTreeViewProvider(api, config, ctx);
	window.registerTreeDataProvider('launchdarklyMetrics', metricsView);

	// Add Quick Links view
	const quickLinksView = new QuickLinksListProvider(config, flagStore);
	window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);

	let aliases;
	if (config.enableAliases) {
		aliases = new FlagAliases(config, ctx);
		if (aliases.codeRefsVersionCheck()) {
			aliases.setupStatusBar();
			aliases.start();
		} else {
			window.showErrorMessage('ld-find-code-refs version > 2 supported.');
		}
	}

	// Add Flag view
	const flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx, aliases);
	window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);

	const codeLens = new FlagCodeLensProvider(api, config, flagStore, aliases);
	const listView = new LaunchDarklyFlagListProvider(config, codeLens);
	window.registerTreeDataProvider('launchdarklyFlagList', listView);

	const LD_MODE: DocumentFilter = {
		scheme: 'file',
	};
	ctx.subscriptions.push(
		window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
		languages.registerCodeLensProvider('*', codeLens),
		languages.registerCompletionItemProvider(
			LD_MODE,
			new LaunchDarklyCompletionItemProvider(config, flagStore, aliases),
			"'",
			'"',
		),
		languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config, flagStore, ctx, aliases)),
	);

	codeLens.start();

	generalCommands(ctx, config, api, flagStore);
}
