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

const STRING_DELIMETERS = ['"', "'", '`'];
export const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};

export async function register(
	ctx: ExtensionContext,
	config: Configuration,
	flagStore: FlagStore,
	api: LaunchDarklyAPI,
): Promise<void> {
	let aliases;

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

		const flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx, aliases);
		window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);
	}
	const codeLens = new FlagCodeLensProvider(api, config, flagStore, aliases);
	languages.registerCodeLensProvider('*', codeLens);
	codeLens.start();
	if (config.enableFlagExplorer) {
		commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}

	ctx.subscriptions.push(
		commands.registerCommand('extension.configureLaunchDarkly', async () => {
			try {
				const configurationMenu = new ConfigurationMenu(config, api);
				await configurationMenu.configure();
				if (typeof flagStore === 'undefined') {
					flagStore = new FlagStore(config, api);
					const flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx);
					window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);
					await flagView.reload();
				} else {
					await flagStore.reload();
					commands.executeCommand('launchdarkly.refreshEntry');
				}
				await ctx.globalState.update('LDConfigured', true);
				window.showInformationMessage('LaunchDarkly configured successfully');
			} catch (err) {
				console.error(err);
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
				window.showErrorMessage(err.message);
			}
		}),
		languages.registerCompletionItemProvider(
			LD_MODE,
			new LaunchDarklyCompletionItemProvider(config, flagStore, aliases),
			"'",
			'"',
		),
		languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config, flagStore, ctx, aliases)),
		commands.registerTextEditorCommand('extension.openInLaunchDarkly', async editor => {
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
				console.error(`${err}`);
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
		}),
	);
}

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
			return new Promise(async resolve => {
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
	const candidate = document
		.getText(c)
		.trim()
		.replace('(', '');
	return STRING_DELIMETERS.indexOf(candidate) !== -1;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);
