import {
	commands,
	languages,
	window,
	ExtensionContext,
	Position,
	TextDocument,
	workspace,
	ConfigurationChangeEvent,
} from 'vscode';

import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { FlagStore } from './flagStore';
import { FlagNode } from './providers/flagListView';
import { ClientSideEnable, refreshDiagnostics, subscribeToDocumentChanges } from './providers/diagnostics';
import globalClearCmd from './commands/clearGlobalContext';
import configureLaunchDarkly from './commands/configureLaunchDarkly';
import { extensionReload, setupComponents } from './utils';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;

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


export function isPrecedingCharStringDelimiter(document: TextDocument, pos: Position): any {
	throw new Error('Function not implemented.');
}
