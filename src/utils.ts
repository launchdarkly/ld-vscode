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

export async function createViews(
	api: LaunchDarklyAPI,
	config: Configuration,
	ctx: ExtensionContext,
	flagStore: FlagStore,
	aliases?: FlagAliases,
) {
	// Add metrics view
	const metricsView = new LaunchDarklyMetricsTreeViewProvider(api, config, ctx);
	window.registerTreeDataProvider('launchdarklyMetrics', metricsView);
	await metricsView.reload();

	// Add Flag view
	const flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx);
	window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);
	await flagView.reload();

	// Add Quick Links view
	const quickLinksView = new QuickLinksListProvider(config, flagStore);
	window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);
	await quickLinksView.reload();

	const codeLens = new FlagCodeLensProvider(api, config, flagStore, aliases);
	const listView = new LaunchDarklyFlagListProvider(config, codeLens);
	window.registerTreeDataProvider('launchdarklyFlagList', listView);
	ctx.subscriptions.push(
		window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
		languages.registerCodeLensProvider('*', codeLens),
	);

	codeLens.start();
}
