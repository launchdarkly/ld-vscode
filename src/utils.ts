import {
	authentication,
	CancellationToken,
	chat,
	ChatAgentFollowup,
	commands,
	Disposable,
	DocumentFilter,
	languages,
	ProgressLocation,
	QuickPickItemKind,
	Uri,
	window,
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
import {
	CopilotProvider,
	LDChatAgentResult,
	LDCONST_CMD_CLEANUP,
	LDCONST_CMD_CODEREFS,
	LDCONST_CMD_EXPLAIN,
	LDCONST_CMD_FLAGINFO,
	LDCONST_CMD_SUGGESTF,
	LDCONST_CMD_WRAP,
} from './providers/copilot';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';

const cache = new ToggleCache();

export async function extensionReload(config: LDExtensionConfiguration, reload = false) {
	// Read in latest version of config
	const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
	if (session !== undefined) {
		// TODO: determine if this reload call to config is needed
		await config.getConfig().reload();
		config.setApi(new LaunchDarklyAPI(config.getConfig(), config));
		config.setFlagStore(new FlagStore(config));
		await setupComponents(config, reload);
	}
}

export async function setupComponents(config: LDExtensionConfiguration, reload = false) {
	const cmds = config.getCtx().globalState.get<Disposable>('commands');
	if (typeof cmds?.dispose === 'function') {
		cmds.dispose();
	}

	if (reload) {
		// Disposables.from does not wait for async disposal so need to wait here.
		await setTimeout(700);
	}

	if (config.getConfig().enableAliases) {
		config.setAliases(new FlagAliases(config.getConfig(), config.getCtx(), config));
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
	const flagView = new LaunchDarklyTreeViewProvider(
		config.getApi(),
		config.getConfig(),
		config,
		config.getFlagStore(),
	);
	const codeLens = new FlagCodeLensProvider(
		config.getApi(),
		config.getConfig(),
		config.getFlagStore(),
		config.getAliases(),
	);
	const listView = new LaunchDarklyFlagListProvider(config.getConfig(), config, codeLens, config.getFlagStore());

	//Register window providers
	window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);
	window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);
	window.registerTreeDataProvider('launchdarklyFlagList', listView);

	const LD_MODE: DocumentFilter = {
		scheme: 'file',
	};
	const hoverProviderDisp = languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config));

	const listViewDisp = commands.registerCommand('launchdarkly.refreshFlagLens', () => listView.setFlagsinDocument());
	const flagToggle = commands.registerCommand('launchdarkly.toggleFlagCmdPrompt', async () => {
		await showToggleMenu(config);
	});
	const openFlag = commands.registerCommand('launchdarkly.OpenFlag', (node: FlagItem) =>
		window.activeTextEditor.revealRange(node.range),
	);
	const codeLensProv = languages.registerCodeLensProvider('*', codeLens)

	config
		.getCtx()
		.subscriptions.push(
			window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
			codeLensProv,
			languages.registerCompletionItemProvider(
				LD_MODE,
				new LaunchDarklyCompletionItemProvider(config.getConfig(), config.getFlagStore(), config.getAliases()),
				"'",
				'"',
			),
			hoverProviderDisp,
			listViewDisp,
			flagToggle,
			openFlag,
		);

	codeLens.start();

	const disposables = await generalCommands(config);
	// TODO: Move so it is only configured once.
	const CopilotP = new CopilotProvider(config, config.getAliases());
	// Agents appear as top-level options in the chat input
	// when you type `@`, and can contribute sub-commands in the chat input
	// that appear when you type `/`.
	const agent = chat.createChatAgent('LaunchDarkly', CopilotP.handler);
	agent.iconPath = Uri.joinPath(config.getCtx().extensionUri, 'osmo.svg');
	agent.description = 'Toggle Bot ready! What can I help you with?';
	agent.fullName = 'Toggle Bot';
	agent.slashCommandProvider = {
		provideSlashCommands(token) {
			return [
				{ name: 'onboard', description: 'help users getting started with LaunchDarkly SaaS feature flagging.' },
				{ name: LDCONST_CMD_WRAP, description: 'Create a flag and wrap code with it.' },
				{ name: LDCONST_CMD_FLAGINFO, description: 'Get info about the selected flag.' },
				{ name: LDCONST_CMD_CODEREFS, description: 'Get info on CodeRefs.' },
				{ name: LDCONST_CMD_CLEANUP, description: 'Remove a feature flag from your codebase.' },
				{
					name: LDCONST_CMD_EXPLAIN,
					description: 'Explain what will happen if the feature flag in selected code is removed.',
				},
				{ name: LDCONST_CMD_SUGGESTF, description: 'Suggest a feature flag for the selected code.' },
			];
		},
	};

	agent.followupProvider = {
		provideFollowups(result: LDChatAgentResult, token: CancellationToken): ChatAgentFollowup[] {
			if (result.slashCommand === LDCONST_CMD_WRAP) {
				return [
					{
						message: 'What is the Flag name?',
					},
				];
			} else if (result.slashCommand === LDCONST_CMD_FLAGINFO) {
				return [
					{
						commandId: `launchdarkly.openInLaunchDarkly`,
						title: 'Open Flag in Browser',
					},
				];
			} else if (result.slashCommand === 'LDCONST_CMD_SUGGESTF') {
				const newKey = config.getCtx().workspaceState.get('LDFlagKey_Copilot');
				const chatCommands = [
					{
						commandId: `launchdarkly.toggleFlagContext`,
						args: [newKey],
						title: 'Toggle Flag On',
					},
				];
				if (config.getSession()?.teams.length > 0) {
					chatCommands.push({
						commandId: `launchdarkly.setMaintainer`,
						args: [newKey],
						title: 'Update Maintainer to Team',
					});
				}
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				return chatCommands;
			} else {
				return [];
			}
		},
	};

	const allDisposables = Disposable.from(disposables, hoverProviderDisp, listViewDisp, flagToggle, openFlag, codeLensProv);
	await config.getCtx().globalState.update('commands', allDisposables);
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
		await window.withProgress(
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

				const enabled = await config.getFlagStore().getFlagConfig(flagWindow.value);
				progress.report({ increment: 10, message: `Setting flag Enabled: ${!enabled.on}` });
				cache.set(flagWindow.value);
				try {
					await config.getApi().patchFeatureFlagOn(config.getConfig().project, flagWindow.value, !enabled.on);
				} catch (err) {
					progress.report({ increment: 100 });
					if (err.response.status === 403) {
						window.showErrorMessage(
							`Unauthorized: Your key does not have permissions to update the flag: ${flagWindow.value}`,
						);
					} else {
						window.showErrorMessage(`Could not update flag: ${flagWindow.value}
						code: ${err.response.status}
						message: ${err.message}`);
					}
				}

				progress.report({ increment: 90, message: 'Flag Toggled' });
			},
		);
	}
}
