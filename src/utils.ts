import { time } from 'console';
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

export async function extensionReload(
	config: Configuration,
	ctx: ExtensionContext,
	disposables?: Array<Disposable>,
): Promise<Array<Disposable>> {
	// Read in latest version of config
	await config.reload();
	const newApi = new LaunchDarklyAPI(config);
	const flagStore = new FlagStore(config, newApi);
	await setupComponents(newApi, config, ctx, flagStore, disposables);
	return generalCommands(ctx, config, newApi, flagStore);
}

export async function setupComponents(
	api: LaunchDarklyAPI,
	config: Configuration,
	ctx: ExtensionContext,
	flagStore: FlagStore,
	disposables?: Array<Disposable>,
) {
	if (disposables) {
		disposables.map((item) => {
			item.dispose();
		});
	}
	const waitTill = new Date(new Date().getTime() + 5 * 1000);
	// eslint-disable-next-line no-empty
	while (waitTill > new Date()) {}

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
}
