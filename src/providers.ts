import {
	commands,
	languages,
	window,
	CompletionItem,
	CompletionItemKind,
	CompletionItemProvider,
	DocumentFilter,
	ExtensionContext,
	Hover,
	HoverProvider,
	Position,
	Range,
	TextDocument,
	MarkdownString,
	ColorThemeKind,
} from 'vscode';
import * as url from 'url';
import opn = require('opn');
import { kebabCase } from 'lodash';
import { Configuration } from './configuration';
import { ConfigurationMenu } from './configurationMenu';
import { LaunchDarklyAPI } from './api';
import { FeatureFlag, FlagConfiguration, FeatureFlagConfig } from './models';
import { FlagStore } from './flagStore';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';
import { FlagAliases } from './providers/codeRefs';
import { FlagCodeLensProvider } from './providers/flagLens';
import * as fs from 'fs';

const STRING_DELIMETERS = ['"', "'", '`'];
const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};
const FLAG_STATUS_CACHE = new Map<string, string>();

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
				console.error(err);
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
		}),
	);
}

class LaunchDarklyHoverProvider implements HoverProvider {
	private readonly flagStore: FlagStore;
	private readonly config: Configuration;
	private readonly aliases?: FlagAliases;
	private readonly ctx: ExtensionContext;

	constructor(config: Configuration, flagStore: FlagStore, ctx: ExtensionContext, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.ctx = ctx;
	}

	public provideHover(document: TextDocument, position: Position): Thenable<Hover> {
		commands.executeCommand('setContext', 'LDFlagToggle', '');
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			if (this.config.enableHover) {
				const candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
				let aliases;
				let foundAlias = [];
				if (typeof this.aliases !== undefined) {
					aliases = this.aliases.getMap();
					if (aliases !== undefined && aliases.length > 0) {
						const aliasKeys = Object.keys(aliases) ? Object.keys(aliases) : [];
						const aliasArr = [...aliasKeys].filter(element => element !== '');
						foundAlias = aliasArr.filter(element => candidate.includes(element));
					}
				}
				try {
					const data =
						(await this.flagStore.getFeatureFlag(candidate)) ||
						(await this.flagStore.getFeatureFlag(kebabCase(candidate))) ||
						(await this.flagStore.getFeatureFlag(aliases[foundAlias[0]])); // We only match on first alias
					if (data) {
						commands.executeCommand('setContext', 'LDFlagToggle', data.flag.key);
						this.ctx.workspaceState.update('LDFlagKey', data.flag.key);
						const hover = generateHoverString(data.flag, data.config, this.config, this.ctx);
						resolve(new Hover(hover));
						return;
					}
				} catch (e) {
					reject(e);
				}
			}
			reject();
		});
	}
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
					const flags = await this.flagStore.allFlags();
					// let aliases;
					// if (this.aliases) {
					// 	aliases = this.aliases;
					// }
					resolve(
						Object.keys(flags).map(flag => {
							return new CompletionItem(flag, CompletionItemKind.Field);
						}),
					);
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

function truncate(str: string, n: number): string {
	return str.length > n ? str.substr(0, n - 1) + '\u2026' : str;
}

export function generateHoverString(
	flag: FeatureFlag,
	c: FlagConfiguration,
	config: Configuration,
	ctx: ExtensionContext,
): MarkdownString {
	const env = Object.keys(flag.environments)[0];
	const flagUri = url.resolve(config.baseUri, flag.environments[env]._site.href);
	const hoverString = new MarkdownString(
		`![Flag status](${getFlagStatusUri(ctx, c.on)}) ${config.project} / ${env} / **[${
			flag.key
		}](${flagUri} "Open in LaunchDarkly")** \n\n`,
		true,
	);
	hoverString.isTrusted = true;

	hoverString.appendText('\n');
	hoverString.appendMarkdown(flag.description);
	hoverString.appendText('\n');

	if (c.prerequisites && c.prerequisites.length > 0) {
		hoverString.appendMarkdown(
			`* Prerequisites: ${c.prerequisites
				.map((p: { key: string; variation: string | number }) => `\`${p.key}\``)
				.join(' ')}\n`,
		);
	}
	if (c.targets && c.targets.length > 0) {
		hoverString.appendMarkdown(`* Targets configured\n`);
	}
	if (c.rules && c.rules.length > 0) {
		hoverString.appendMarkdown(`* Rules configured\n`);
	}
	hoverString.appendText('\n');

	let varTypeIcon;
	const varType = flag.kind === 'multivariate' ? typeof flag.variations[0].value : flag.kind;
	switch (varType) {
		case 'boolean':
			varTypeIcon = '$(symbol-boolean)';
			break;
		case 'number':
			varTypeIcon = '$(symbol-number)';
			break;
		case 'object':
			varTypeIcon = '$(symbol-object)';
			break;
		case 'string':
			varTypeIcon = '$(symbol-key)';
			break;
		default:
			break;
	}

	hoverString.appendMarkdown(`**${varTypeIcon} Variations**`);
	flag.variations.map((variation, idx) => {
		const props = [];
		if (c.offVariation !== undefined && c.offVariation === idx) {
			props.push('`$(arrow-small-right)off`');
		}
		if (c.fallthrough) {
			if (c.fallthrough.variation !== undefined && c.fallthrough.variation === idx) {
				props.push('`$(arrow-small-right)fallthrough`');
			}
		}
		if (c.fallthrough.rollout) {
			props.push(`\`$(arrow-small-right)rollout @ ${c.fallthrough.rollout.variations[idx].weight / 1000}%\``);
		}

		const varVal = `\`${truncate(JSON.stringify(variation.value), 30).trim()}\``;
		const varName = variation.name ? ` **${variation.name}**` : '';
		const varDescription = variation.description ? `: ${variation.description}` : '';
		hoverString.appendText('\n');
		hoverString.appendMarkdown(`* ${varVal}${varName}${varDescription} ${props.length ? props.join(' ') : ''}`);
	});

	return hoverString;
}

function getFlagStatusUri(ctx: ExtensionContext, status: boolean) {
	const fileName = status ? 'toggleon' : 'toggleoff';
	const theme: ColorThemeKind = window.activeColorTheme.kind;
	const colorTheme = ColorThemeKind[theme] === 'Light' ? 'light' : 'dark';
	let dataUri = FLAG_STATUS_CACHE.get(`${colorTheme}-${fileName}`);
	if (dataUri == null && ctx !== undefined) {
		const contents = fs.readFileSync(ctx.asAbsolutePath(`resources/${colorTheme}/${fileName}.svg`)).toString('base64');

		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		FLAG_STATUS_CACHE.set(`${colorTheme}-${fileName}`, dataUri);
	}

	return dataUri;
}

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
	const candidate = document.getText(c).trim();
	return STRING_DELIMETERS.indexOf(candidate) !== -1;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);
