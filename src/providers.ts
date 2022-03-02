import {
	commands,
	languages,
	window,
	ExtensionContext,
	Position,
	TextDocument,
	workspace,
	ConfigurationChangeEvent,
	OutputChannel,
} from 'vscode';

import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagNode } from './providers/flagListView';
import { ClientSideEnable, refreshDiagnostics, subscribeToDocumentChanges } from './providers/diagnostics';
import PubNub from 'pubnub';
import globalClearCmd from './commands/clearGlobalContext';
import configureLaunchDarkly from './commands/configureLaunchDarkly';
import { extensionReload, setupComponents } from './utils';
import generalCommands from './commands/generalCommands';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;

type DebuggerWindows = Record<string, OutputChannel>;

export async function register(
	ctx: ExtensionContext,
	config: Configuration,
	flagStore: FlagStore,
	api: LaunchDarklyAPI,
): Promise<void> {
	let aliases;

	await globalClearCmd(ctx, config);

	//ctx.globalState.update("commands", generalCommands(ctx, config, api, flagStore));
	await configureLaunchDarkly(ctx, config, api, flagStore);

	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			extensionReload(config, ctx);
		}
	});
	if (!config.isConfigured) {
		return;
	}
	if (typeof flagStore !== 'undefined') {
		setupComponents(api, config, ctx, flagStore);

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

		ctx.subscriptions.push(
			commands.registerCommand('launchdarkly.OpenFlag', (node: FlagNode) =>
				window.activeTextEditor.revealRange(node.range),
			),
		);
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

export function isPrecedingCharStringDelimiter(document: TextDocument, pos: Position): any {
	throw new Error('Function not implemented.');
}
