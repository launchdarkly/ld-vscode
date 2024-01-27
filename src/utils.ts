import {
	authentication,
	commands,
	Disposable,
	DocumentFilter,
	languages,
	ProgressLocation,
	QuickPickItemKind,
	window,
	workspace,
} from 'vscode';
import { LaunchDarklyAPI } from './api';
import generalCommands from './commands/generalCommands';
import { FlagStore } from './flagStore';
import { FlagAliases } from './providers/codeRefs';
import LaunchDarklyCompletionItemProvider from './providers/completion';
import { FlagCodeLensProvider } from './providers/flagLens';
import { FlagItem, LaunchDarklyFlagListProvider } from './providers/flagListView';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { LaunchDarklyHoverProvider } from './providers/hover';
import { QuickLinksListProvider } from './providers/quickLinksView';
import { setTimeout } from 'timers/promises';
import { ToggleCache } from './toggleCache';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
import { LaunchDarklyReleaseProvider } from './providers/releaseViewProvider';
import { InstructionPatch } from './models';

const cache = new ToggleCache();

export async function extensionReload(config: LDExtensionConfiguration, reload = false) {
	const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
	if (session !== undefined) {
		// TODO: determine if this reload call to config is needed
		await config.getConfig().reload();
		config.setApi(new LaunchDarklyAPI(config.getConfig(), config));
		config.setFlagStore(new FlagStore(config));
		await setupComponents(config, reload);
	} else {
		console.log('No session found, please login to LaunchDarkly.');
	}
}

export async function setupComponents(config: LDExtensionConfiguration, reload = false) {
	const cmds = config.getCtx().globalState.get<Disposable>('commands');
	if (typeof cmds?.dispose === 'function') {
		cmds.dispose();
	}

	if (reload) {
		// Disposables.from does not wait for async disposal so need to wait here.
		await setTimeout(2200);
	}

	if (config.getConfig().enableAliases) {
		config.setAliases(new FlagAliases(config));
		//aliases = new FlagAliases(config.getConfig(), ctx);
		if (config.getAliases().codeRefsVersionCheck()) {
			config.getAliases().setupStatusBar();
			await config.getAliases().start();
		} else {
			window.showErrorMessage('ld-find-code-refs version > 2 supported.');
		}
	}

	// Add various providers
	const quickLinksView = new QuickLinksListProvider(config);
	const flagView = new LaunchDarklyTreeViewProvider(config);
	const codeLens = new FlagCodeLensProvider(config);

	const enableFlagListView = workspace.getConfiguration('launchdarkly').get('enableFlagsInFile', false)
	let listViewDisp = Disposable.from();
	if (enableFlagListView) {
		const listView = new LaunchDarklyFlagListProvider(config, codeLens);
		window.registerTreeDataProvider('launchdarklyFlagList', listView);
		listViewDisp = commands.registerCommand('launchdarkly.refreshFlagLens', () => listView.setFlagsinDocument());
		config
			.getCtx()
			.subscriptions.push(
				window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
				listViewDisp
			);
	}
 	

	const enableReleasesView = workspace.getConfiguration('launchdarkly').get('enableReleasesView', false)
	if (enableReleasesView) {
		const releaseView = new LaunchDarklyReleaseProvider(config);
		window.registerTreeDataProvider('launchdarklyReleases', releaseView);
	}
	

	config.setFlagView(flagView);

	//Register window providers
	window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);
	config.setFlagTreeProvider(
		window.createTreeView('launchdarklyFeatureFlags', {
			treeDataProvider: flagView,
		}),
	);
	
	

	const LD_MODE: DocumentFilter = {
		scheme: 'file',
	};
	const hoverProviderDisp = languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config));

	try {
		
		const flagToggle = commands.registerCommand('launchdarkly.toggleFlagCmdPrompt', async () => {
			await showToggleMenu(config);
		});
		const openFlag = commands.registerCommand('launchdarkly.OpenFlag', (node: FlagItem) =>
			window.activeTextEditor.revealRange(node.range),
		);
		const codeLensProv = languages.registerCodeLensProvider([LD_MODE], codeLens);

		config
			.getCtx()
			.subscriptions.push(
				codeLensProv,
				languages.registerCompletionItemProvider(
					LD_MODE,
					new LaunchDarklyCompletionItemProvider(config.getConfig(), config.getFlagStore(), config.getAliases()),
					"'",
					'"',
				),
				hoverProviderDisp,
				flagToggle,
				openFlag,
			);

		codeLens.start();

		const disposables = await generalCommands(config);

		const allDisposables = Disposable.from(
			disposables,
			hoverProviderDisp,
			listViewDisp,
			flagToggle,
			openFlag,
			codeLensProv,
		);
		await config.getCtx().globalState.update('commands', allDisposables);
	} catch (err) {
		console.error(err);
	}
}

async function showToggleMenu(config: LDExtensionConfiguration) {
	let flags;
	try {
		flags = await config.getFlagStore().allFlagsMetadata();
	} catch (err) {
		window.showErrorMessage('[LaunchDarkly] Unable to retrieve flags, please check configuration.');
		return;
	}
	const items = [];
	const cachedFlags = Array.from(cache.get()).reverse();
	if (cachedFlags.length > 0) {
		items.push({
			label: 'Recently toggled Feature Flags',
			kind: QuickPickItemKind.Separator,
		});
		cachedFlags.forEach((flag) => {
			items.push({
				label: flags[flag].name,
				description: flags[flag].key,
				value: flags[flag].key,
			});
		});

		items.push({
			label: 'Feature Flag List',
			kind: QuickPickItemKind.Separator,
		});
	}
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
		toggleFlag(config, flagWindow.value);
	}
}

export async function toggleFlag(config: LDExtensionConfiguration, key: string) {
	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: `LaunchDarkly: Toggling Flag ${key}`,
			cancellable: true,
		},
		async (progress, token) => {
			token.onCancellationRequested(() => {
				console.log('User canceled the long running operation');
			});

			progress.report({ increment: 0 });

			const enabled = await config.getFlagStore().getFlagConfig(key);
			progress.report({ increment: 10, message: `Setting flag Enabled: ${!enabled.on}` });
			cache.set(key);
			try {
				await config.getApi().patchFeatureFlagOn(config.getConfig().project, key, !enabled.on);
			} catch (err) {
				progress.report({ increment: 100 });
				if (err.response.status === 403) {
					window.showErrorMessage(`Unauthorized: Your key does not have permissions to update the flag: ${key}`);
				} else {
					window.showErrorMessage(`Could not update flag: ${key}
					code: ${err.response.status}
					message: ${err.message}`);
				}
			}

			progress.report({ increment: 90, message: 'Flag Toggled' });
		},
	);
}

export function logDebugMessage(message: string) {
	const debugLogging = workspace.getConfiguration('launchdarkly').get('debugLogging', false);
	if (debugLogging) {
		console.log(message);
	}
}

export function flagCodeSearch(config: LDExtensionConfiguration, key: string) {
	let aliases;
	let findAliases: string;
	if (config.getAliases()) {
		aliases = config.getAliases()?.getKeys();
	}
	if (aliases && aliases[key]) {
		const tempSearch = [...aliases[key]];
		tempSearch.push(key);
		findAliases = tempSearch.join('|');
	} else {
		findAliases = key;
	}
	commands.executeCommand('workbench.action.findInFiles', {
		query: findAliases,
		triggerSearch: true,
		matchWholeWord: true,
		isCaseSensitive: true,
		isRegex: true,
	});
}

export async function flagOffFallthroughPatch(
	config: LDExtensionConfiguration,
	kind: string,
	key: string,
): Promise<void> {
	const env = await config.getFlagStore()?.getFeatureFlag(key);

	const variations = env?.flag.variations?.map((variation, idx) => {
		return {
			label: `${idx}. ${
				JSON.stringify(variation.name) ? JSON.stringify(variation.name) : JSON.stringify(variation.value)
			}`,
			value: variation._id,
		};
	});
	if (!variations) {
		return;
	}

	const choice = await window.showQuickPick(variations);
	if (!choice) {
		return;
	}

	const selectedVariation = choice.value;
	//const patch: { op: string; path: string; value?: number }[] = [];
	// patch.push({ op: 'replace', path: path, value: parseInt(newValue) });
	const instructionPatch: InstructionPatch = {
		environmentKey: config.getConfig().env,
		instructions: [createFallthroughOrOffInstruction(kind, selectedVariation)],
	};

	//patchComment.patch = patch;
	try {
		await config.getApi()?.patchFeatureFlagSem(config.getConfig().project, key, instructionPatch);
	} catch (err) {
		if (err.statusCode === 403) {
			window.showErrorMessage('Unauthorized: Your key does not have permissions to change the flag.', err);
		} else {
			window.showErrorMessage(`Could not update flag: ${err.message}`);
		}
	}
}

function createFallthroughOrOffInstruction(kind: string, variationId: string) {
	return {
		kind,
		variationId: variationId,
	};
}

export function legacyAuth() {
	return true; 
	//workspace.getConfiguration('launchdarkly').get('legacyAuth', false)
}
