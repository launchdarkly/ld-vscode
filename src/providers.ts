import {
	commands,
	languages,
	window,
	CompletionItem,
	CompletionItemKind,
	CompletionItemProvider,
	DocumentFilter,
	ExtensionContext,
	Position,
	Range,
	TextDocument,
	workspace,
	ConfigurationChangeEvent,
	OutputChannel,
} from 'vscode';
import * as url from 'url';
import opn = require('opn');
import { kebabCase } from 'lodash';
import { Configuration } from './configuration';
import { ConfigurationMenu } from './configurationMenu';
import { LaunchDarklyAPI } from './api';
import { FeatureFlagConfig } from './models';
import { FlagStore } from './flagStore';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { FlagAliases } from './providers/codeRefs';
import { FlagCodeLensProvider } from './providers/flagLens';
import { LaunchDarklyHoverProvider } from './providers/hover';
import { FlagNode, LaunchDarklyFlagListProvider } from './providers/flagListView';
import { ClientSideEnable, refreshDiagnostics, subscribeToDocumentChanges } from './providers/diagnostics';
import { LaunchDarklyMetricsTreeViewProvider } from './providers/metricsView';
import PubNub from 'pubnub';
import { QuickLinksListProvider } from './providers/quickLinksView';

const STRING_DELIMETERS = ['"', "'", '`'];
export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};

type DebuggerWindows = Record<string, OutputChannel>;

export async function register(
	ctx: ExtensionContext,
	config: Configuration,
	flagStore: FlagStore,
	api: LaunchDarklyAPI,
): Promise<void> {
	let aliases;
	let flagView;

	ctx.subscriptions.push(
		commands.registerCommand('extension.configureLaunchDarkly', async () => {
			try {
				const configurationMenu = new ConfigurationMenu(config, api);
				await configurationMenu.configure();
				const metricsView = new LaunchDarklyMetricsTreeViewProvider(api, config, ctx);
				window.registerTreeDataProvider('launchdarklyMetrics', metricsView);
				if (typeof flagStore === 'undefined') {
					flagStore = new FlagStore(config, api);
					flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx);
					window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);
					await flagView.reload();
				} else {
					await flagStore.reload();
					await flagView.reload();
				}
				await ctx.globalState.update('LDConfigured', true);
				window.showInformationMessage('LaunchDarkly configured successfully');
			} catch (err) {
				console.error(`Failed configuring LaunchDarkly Extension(provider): ${err}`);
				window.showErrorMessage('An unexpected error occurred, please try again later.');
			}
		}),

		commands.registerCommand('launchdarkly.toggleFlagContext', async () => {
			try {
				const key = ctx.workspaceState.get('LDFlagKey') as string;
				if (key) {
					const env = await flagStore.getFeatureFlag(key);
					await api.patchFeatureFlagOn(config.project, key, !env.config.on);
				}
			} catch (err) {
				window.showErrorMessage(`Could not patch flag: ${err.message}`);
			}
		}),
		commands.registerTextEditorCommand('extension.openInLaunchDarkly', async (editor) => {
			const flagKey = editor.document.getText(
				editor.document.getWordRangeAtPosition(editor.selection.anchor, FLAG_KEY_REGEX),
			);
			if (!flagKey) {
				window.showErrorMessage(
					'[LaunchDarkly] Error retrieving flag (current cursor position is not a feature flag).',
				);
				return;
			}

			if (!config.accessToken) {
				window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
				return;
			}

			if (!config.project) {
				window.showErrorMessage('[LaunchDarkly] project is not set.');
				return;
			}

			try {
				const fKey = ctx.workspaceState.get('LDFlagKey') as string;
				await openFlagInBrowser(config, fKey, flagStore);
			} catch (err) {
				let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
				if (err.statusCode == 404) {
					// Try resolving the flag key to kebab case
					try {
						await openFlagInBrowser(config, kebabCase(flagKey), flagStore);
						return;
					} catch (err) {
						if (err.statusCode == 404) {
							errMsg = `Could not find the flag ${flagKey}`;
						}
					}
				}
				console.error(`Failed opening browser: ${err}`);
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
		}),
		commands.registerCommand('launchdarkly.clearGlobalContext', async () => {
			try {
				await config.clearGlobalConfig();
				window.showInformationMessage('LaunchDarkly global settings removed');
			} catch (err) {
				console.error(`Failed clearing global context: ${err}`);
				window.showErrorMessage('An unexpected error occurred, please try again later.');
			}
		}),
	);
	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			await config.reload();
			if (!flagStore) {
				const newApi = new LaunchDarklyAPI(config);
				flagStore = new FlagStore(config, newApi);
			}
			await flagStore.reload(e);
			await flagView.reload(e);
		}
	});
	if (!config.isConfigured) {
		return;
	}
	if (typeof flagStore !== 'undefined') {
		if (config.enableAliases) {
			aliases = new FlagAliases(config, ctx);
			if (aliases.codeRefsVersionCheck()) {
				aliases.setupStatusBar();
				aliases.start();
			} else {
				window.showErrorMessage('ld-find-code-refs version > 2 supported.');
			}
		}
		const metricsView = new LaunchDarklyMetricsTreeViewProvider(api, config, ctx);
		window.registerTreeDataProvider('launchdarklyMetrics', metricsView);

		flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx, aliases);
		window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);

		const quickLinksView = new QuickLinksListProvider(config, flagStore);
		window.registerTreeDataProvider('launchdarklyQuickLinks', quickLinksView);

		const codeLens = new FlagCodeLensProvider(api, config, flagStore, aliases);
		const listView = new LaunchDarklyFlagListProvider(config, codeLens);
		window.registerTreeDataProvider('launchdarklyFlagList', listView);

		const Lddebugger = window.createOutputChannel('LaunchDarkly All');
		const LddIdentify = window.createOutputChannel('LaunchDarkly Identify Debug');
		const LddFeature = window.createOutputChannel('LaunchDarkly Feature Flag Debug');
		const LddIndex = window.createOutputChannel('LaunchDarkly Index Debug');
		const LddSummary = window.createOutputChannel('LaunchDarkly Summary Debug');
		const debuggers = {
			all: Lddebugger,
			identify: LddIdentify,
			features: LddFeature,
			index: LddIndex,
			summary: LddSummary,
		};
		const debugCipher = ctx.workspaceState.get('debugCipher') as string;

		const ldConfig = workspace.getConfiguration('launchdarkly');
		const subKey = ldConfig.get('debuggerKey', '').trim();

		if (debugCipher && subKey) {
			const pubnub = new PubNub({
				subscribeKey: subKey,
				cipherKey: debugCipher,
				ssl: true,
				useRandomIVs: false,
			});
			ctx.subscriptions.push(
				commands.registerCommand('launchdarkly.enableDebugger', () => {
					enableDebugger(ctx, debuggers, pubnub);
				}),
			);
		}

		ctx.subscriptions.push(window.onDidChangeActiveTextEditor(listView.setFlagsinDocument));
		ctx.subscriptions.push(
			window.onDidChangeActiveTextEditor(listView.setFlagsinDocument),
			commands.registerCommand('launchdarkly.OpenFlag', (node: FlagNode) =>
				window.activeTextEditor.revealRange(node.range),
			),
			languages.registerCompletionItemProvider(
				LD_MODE,
				new LaunchDarklyCompletionItemProvider(config, flagStore, aliases),
				"'",
				'"',
			),
			languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config, flagStore, ctx, aliases)),
			languages.registerCodeLensProvider('*', codeLens),
			commands.registerTextEditorCommand('extension.openLDFlagTree', async () => {
				const key = ctx.workspaceState.get('LDFlagKey') as string;
				if (key) {
					flagView.reveal(key);
				}
			}),
		);
		codeLens.start();
	}

	if (config.enableFlagExplorer) {
		commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}

	const clientSideDiagnostics = languages.createDiagnosticCollection('clientSide');
	ctx.subscriptions.push(
		clientSideDiagnostics,
		languages.registerCodeActionsProvider('*', new ClientSideEnable(), {
			providedCodeActionKinds: ClientSideEnable.providedCodeActionKinds,
		}),
		commands.registerCommand('launchdarkly.enableClientSide', async (args) => {
			try {
				const patchOperation = [{ op: 'replace', path: '/clientSideAvailability/usingEnvironmentId', value: true }];
				await api.patchFeatureFlag(config.project, args, { comment: 'VS Code Updated', patch: patchOperation });
				// Global updates are not automatic, need to refresh flag for diagnostics.
				await flagStore.forceFeatureFlagUpdate(args);
				refreshDiagnostics(window.activeTextEditor.document, clientSideDiagnostics, aliases, flagStore);
			} catch (err) {
				console.log(err);
			}
		}),
	);
	subscribeToDocumentChanges(ctx, clientSideDiagnostics, aliases, flagStore);
}

const enableDebugger = (ctx: ExtensionContext, debuggers: DebuggerWindows, pubnub: PubNub) => {
	const LddIdentify = debuggers['identify'];
	const LddFeature = debuggers['features'];
	const LddIndex = debuggers['index'];
	const Lddebugger = debuggers['all'];
	const LddSummary = debuggers['summary'];

	const debugChannel = ctx.workspaceState.get('debugChannel') as string;

	if (debugChannel) {
		pubnub.unsubscribeAll();
		Object.entries(debuggers).forEach(([, value]) => {
			value.clear();
			value.appendLine('Starting Debugger');
		});
		pubnub.addListener({
			message: function (m) {
				if (Array.isArray(m.message)) {
					m.message.forEach(async (msg) => {
						switch (msg.kind) {
							case 'identify': {
								const parsedMsg = parseIdentify(msg);
								LddIdentify.append(parsedMsg);
								Lddebugger.append('- - - -\nIdentify Event:\n' + parsedMsg);
								break;
							}
							case 'feature': {
								const parsedMsg = parseFeature(msg);
								LddFeature.append(parsedMsg);
								Lddebugger.append('- - - -\nFeature Event:\n' + parsedMsg);
								break;
							}
							case 'index': {
								const parsedMsg = parseIndex(msg);
								LddIndex.append(parsedMsg);
								Lddebugger.append('- - - -\nIndex Event:\n' + parsedMsg);
								break;
							}
							case 'summary': {
								const parsedMsg = parseSummary(msg);
								LddSummary.append(parsedMsg);
								Lddebugger.append('- - - -\nSummary Event:\n' + parsedMsg);
								break;
							}
							default:
								Lddebugger.append(JSON.stringify(msg));
						}
					});
				} else {
					console.log(m);
					Lddebugger.appendLine(m.message);
				}
			},
		});

		pubnub.subscribe({
			channels: [debugChannel],
		});

		setTimeout(() => {
			pubnub.unsubscribeAll();
			const CLOSING_DEBUGGER = 'Disconnecting Debugger';
			LddFeature.appendLine(CLOSING_DEBUGGER);
			Lddebugger.appendLine(CLOSING_DEBUGGER);
			LddIdentify.appendLine(CLOSING_DEBUGGER);
			LddIndex.appendLine(CLOSING_DEBUGGER);
		}, 5 * 60 * 1000);
	}
};

type UserEvent = {
	key: string;
	email?: string;
	anonymous?: boolean;
	custom?: Record<string, unknown>;
	privateAttrs?: Record<string, unknown>;
};

type IdentifyEvent = {
	kind: string;
	key: string;
	user: UserEvent;
};

type IndexEvent = {
	key: string;
	anonymous?: boolean;
	user: UserEvent;
};

type FeatureEvent = {
	kind: string;
	key: string;
	value: unknown;
	variation: number;
	default: unknown;
	creationDate: number;
	version: number;
	reason?: unknown;
	userKey: string;
};

type SummaryEvent = {
	startDate: number;
	endDate: number;
	features: Record<string, FeatureSummary>;
};

type FeatureCounter = {
	version: number;
	variation: number;
	value: unknown;
	count: number;
};
type FeatureSummary = {
	default: number;
	counters: Array<FeatureCounter>;
};

const parseSummary = (event: SummaryEvent) => {
	const startDate = new Date(event.startDate);
	const endDate = new Date(event.endDate);
	let line = `Start Time: ${startDate.toString()} / End Time: ${endDate.toString()}\n`;

	Object.entries(event.features).forEach(([key, feature]) => {
		line = line + `	flag key: ${key}\n`;
		line = line + `		default value: ${feature.default}\n`;
		feature.counters.forEach((counter) => {
			line = line + `		count: ${counter.count}\n`;
			line = line + ` 		value: ${counter.value}\n`;
			line = line + ` 		variation: ${counter.variation}\n`;
			line = line + `		version ${counter.version}\n`;
		});
	});
	return line;
};
const parseIdentify = (event: IdentifyEvent) => {
	let line = `Key: ${event.key}
	email: ${event.user.email}`;

	if (event.user.custom) {
		line =
			line +
			`
	custom:\n`;
		const customEvent = event.user.custom;
		Object.entries(customEvent).forEach(([key, value]) => (line = line + `		${key}: ${value}\n`));
	}

	if (event.user.privateAttrs) {
		line =
			line +
			`
		private attributes:\n`;
		const privateAttrs = event.user.privateAttrs;
		Object.entries(privateAttrs).forEach(([key, value]) => (line = line + `		${key}: ${value}\n`));
	}
	line = line + `\n`;
	return line;
};

const parseIndex = (event: IndexEvent) => {
	let line = `key: ${event.user.key}\n`;
	if (event.user.anonymous) {
		line = line + `	anonymous: ${event.user.anonymous}\n`;
	}

	if (event.user.custom) {
		line = line + `	custom:\n`;
		const customEvent = event.user.custom;
		Object.entries(customEvent).forEach(([key, value]) => (line = line + `		${key}: ${value}\n`));
	}
	return line;
};
const parseFeature = (event: FeatureEvent) => {
	const d = new Date(event.creationDate);

	let line = `${d.toString()}
	key: ${event.key}
	value: ${event.value}
	variation: ${event.variation}\n`;

	if (event.reason) {
		line = line + `\n	reason: ${event.reason}`;
	}

	return line;
};
class LaunchDarklyCompletionItemProvider implements CompletionItemProvider {
	private readonly flagStore: FlagStore;
	private readonly config: Configuration;
	private readonly aliases?: FlagAliases;

	constructor(config: Configuration, flagStore: FlagStore, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
	}

	public provideCompletionItems(document: TextDocument, position: Position): Thenable<CompletionItem[]> {
		if (isPrecedingCharStringDelimiter(document, position)) {
			// eslint-disable-next-line no-async-promise-executor
			return new Promise(async (resolve) => {
				if (this.config.enableAutocomplete) {
					const flags = await this.flagStore.allFlagsMetadata();
					const flagCompletes = [];
					for (const [key, flag] of Object.entries(flags)) {
						const flagCompletion = new CompletionItem(flag.key, CompletionItemKind.Field);
						flagCompletion.detail = flag.description ? flag.description : '';
						flagCompletes.push(flagCompletion);
					}
					resolve(flagCompletes);
					return;
				}
				resolve(null);
			});
		}
	}
}

const openFlagInBrowser = async (config: Configuration, flagKey: string, flagStore: FlagStore) => {
	const { flag } = await flagStore.getFeatureFlag(flagKey);

	// Default to first environment
	let env: FeatureFlagConfig = Object.values(flag.environments)[0];
	let sitePath = env._site.href;

	if (!config.env) {
		window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	} else if (!flag.environments[config.env]) {
		window.showWarningMessage(
			`[LaunchDarkly] Configured environment '${config.env}' has been deleted. Falling back to first environment.`,
		);
	} else {
		env = flag.environments[config.env];
		sitePath = env._site.href;
	}
	opn(url.resolve(config.baseUri, sitePath));
};

export function isPrecedingCharStringDelimiter(document: TextDocument, position: Position): boolean {
	const range = document.getWordRangeAtPosition(position, FLAG_KEY_REGEX);
	if (!range || !range.start || range.start.character === 0) {
		return false;
	}
	const c = new Range(
		range.start.line,
		candidateTextStartLocation(range.start.character),
		range.start.line,
		range.start.character,
	);
	const candidate = document.getText(c).trim().replace('(', '');
	return STRING_DELIMETERS.indexOf(candidate) !== -1;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);
