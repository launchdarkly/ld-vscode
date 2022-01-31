import { commands, ExtensionContext, languages, window } from 'vscode';
import { LaunchDarklyAPI } from './api';
import { Configuration } from './configuration';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import { FlagCodeLensProvider } from './providers/flagLens';
import { LaunchDarklyFlagListProvider } from './providers/flagListView';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { LaunchDarklyMetricsTreeViewProvider } from './providers/metricsView';
import { QuickLinksListProvider } from './providers/quickLinksView';

export default async function checkExistingCommand(commandName: string): Promise<boolean> {
	const checkCommands = await commands.getCommands(false);
	if (checkCommands.includes(commandName)) {
		return true;
	}
	return false;
}

export async function extensionReload(config: Configuration, ctx: ExtensionContext) {
	// Read in latest version of config
	await config.reload();
	const newApi = new LaunchDarklyAPI(config);
	const flagStore = new FlagStore(config, newApi);
	await setupComponents(newApi, config, ctx, flagStore);
}

export async function setupComponents(
	api: LaunchDarklyAPI,
	config: Configuration,
	ctx: ExtensionContext,
	flagStore: FlagStore,
	aliases?: FlagAliases,
) {
	// Add metrics view
	const metricsView = new LaunchDarklyMetricsTreeViewProvider(api, config, ctx);
	window.registerTreeDataProvider('launchdarklyMetrics', metricsView);

	// Add Quick Links view
	const quickLinksView = new QuickLinksListProvider(config, flagStore);
	window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);

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
	ctx.subscriptions.push(
		window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
		languages.registerCodeLensProvider('*', codeLens),
	);

	codeLens.start();
}
