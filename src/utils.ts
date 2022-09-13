import { commands, Disposable, DocumentFilter, ExtensionContext, languages, ProgressLocation, window } from 'vscode';
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
import { setTimeout } from 'timers/promises';

export default async function checkExistingCommand(commandName: string): Promise<boolean> {
	const checkCommands = await commands.getCommands(false);
	if (checkCommands.includes(commandName)) {
		return true;
	}
	return false;
}

export async function extensionReload(config: Configuration, ctx: ExtensionContext, reload = false) {
	// Read in latest version of config
	config.reload();
	const newApi = new LaunchDarklyAPI(config);
	const flagStore = new FlagStore(config, newApi);
	await setupComponents(newApi, config, ctx, flagStore, reload);
}

export async function setupComponents(
	api: LaunchDarklyAPI,
	config: Configuration,
	ctx: ExtensionContext,
	flagStore: FlagStore,
	reload = false,
) {
	const cmds = ctx.globalState.get<Disposable>('commands');
	if (typeof cmds?.dispose === 'function') {
		cmds.dispose();
	}

	if (reload) {
		// Disposables.from does not wait for async disposal so need to wait here.
		await setTimeout(700);
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
	const listView = new LaunchDarklyFlagListProvider(config, codeLens, flagStore, flagView);
	window.registerTreeDataProvider('launchdarklyFlagList', listView);

	const LD_MODE: DocumentFilter = {
		scheme: 'file',
	};

	const hoverProviderDisp = languages.registerHoverProvider(
		LD_MODE,
		new LaunchDarklyHoverProvider(config, flagStore, ctx, aliases),
	);

	const listViewDisp = commands.registerCommand('launchdarkly.refreshFlagLens', () => listView.setFlagsinDocument());
	const flagToggle = commands.registerCommand('launchdarkly.toggleFlagCmdPrompt', async () => {
		await showToggleMenu(flagStore, api, config);
	});
	ctx.subscriptions.push(
		window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
		languages.registerCodeLensProvider('*', codeLens),
		languages.registerCompletionItemProvider(
			LD_MODE,
			new LaunchDarklyCompletionItemProvider(config, flagStore, aliases),
			"'",
			'"',
		),
		hoverProviderDisp,
		listViewDisp,
		flagToggle,
	);

	codeLens.start();

	const disposables = await generalCommands(ctx, config, api, flagStore);
	const allDisposables = Disposable.from(disposables, hoverProviderDisp, listViewDisp, flagToggle);
	await ctx.globalState.update('commands', allDisposables);
}

async function showToggleMenu(flagStore: FlagStore, api: LaunchDarklyAPI, config: Configuration) {
	const flags = await flagStore.allFlagsMetadata();
	const items = [];
	Object.keys(flags).forEach((flag) =>
		items.push({
			label: flags[flag].name,
			description: flags[flag].key,
			value: flags[flag].key,
		}),
	);
	const flagWindow = await window.showQuickPick(items, {
		title: 'Select Feature Flag to Toggle',
		placeHolder: 'Type flag key to toggle',
		matchOnDescription: true,
	});

	if (typeof flagWindow !== 'undefined') {
		window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `LaunchDarkly: Toggling Flag ${flagWindow.value}`,
				cancellable: true,
			},
			async (progress, token) => {
				token.onCancellationRequested(() => {
					console.log('User canceled the long running operation');
				});

				progress.report({ increment: 0 });

				const enabled = await flagStore.getFlagConfig(flagWindow.value);
				progress.report({ increment: 10, message: `Setting flag Enabled: ${!enabled.on}` });

				await api.patchFeatureFlagOn(config.project, flagWindow.value, !enabled.on);

				progress.report({ increment: 90, message: 'Flag Toggled' });
			},
		);
	}
}
