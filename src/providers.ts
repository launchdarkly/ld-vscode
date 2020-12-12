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


const STRING_DELIMETERS = ['"', "'", '`'];
const FLAG_KEY_REGEX = /[A-Za-z0-9][.A-Za-z_\-0-9]*/;
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
		if (config.enableAliases && config.codeRefsPath !== '') {
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
				let foundAlias;
				let aliases;
				let aliasArr;
				if (this.aliases) {
					aliases = this.aliases.getMap();
					const aliasKeys = Object.keys(aliases);
					aliasArr = [...aliasKeys].filter(element => element !== '');
					foundAlias = aliasArr.filter(element => candidate.includes(element));
				} else {
					foundAlias = {};
				}
				try {
					const data =
						(await this.flagStore.getFeatureFlag(candidate)) ||
						(await this.flagStore.getFeatureFlag(kebabCase(candidate))) ||
						(await this.flagStore.getFeatureFlag(aliases[foundAlias[0]]));
					if (data) {
						const env = data.flag.environments[this.config.env];
						const sitePath = env._site.href;
						const browserUrl = url.resolve(this.config.baseUri, sitePath);
						commands.executeCommand('setContext', 'LDFlagToggle', data.flag.key);
						this.ctx.workspaceState.update('LDFlagKey', data.flag.key);
						const hover = generateHoverString(data.flag, data.config, browserUrl);
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
		if (isPrecedingCharStringDelimeter(document, position)) {
			// eslint-disable-next-line no-async-promise-executor
			return new Promise(async resolve => {
				if (this.config.enableAutocomplete) {
					const flags = await this.flagStore.allFlags();
					let aliases;
					if (this.aliases) {
						aliases = this.aliases;
					}
					resolve(
						Object.keys(flags).map(flag => {
							return new CompletionItem(flag, CompletionItemKind.Field);
						}),
					);
					return;
				}
				resolve();
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

export function generateHoverString(flag: FeatureFlag, c: FlagConfiguration, url?: string): MarkdownString {
	let name = '';
	if (flag.name) {
		name = `\u2022 ${flag.name} `;
	}
	const hoverString = new MarkdownString(`**LaunchDarkly feature flag** ${name}   [$(link-external)](${url})`, true);

	let describeStr = '';
	if (flag.description) {
		describeStr = describeStr + flag.description;
	}
	hoverString.appendText('\n');
	hoverString.appendMarkdown(describeStr);
	hoverString.appendText('\n');
	let Prereqs = '';
	if (c.prerequisites && c.prerequisites.length > 0) {
		Prereqs = `\u2022 prerequisites ${c.prerequisites.length}`;
	}

	let targets = ``;
	if (c.targets && targets.length > 0) {
		const count = c.targets.reduce((acc, curr) => acc + curr.values.length, 0);
		targets = `\u2022 targets ${count}`;
	}

	let rules = ``;
	if (c.rules && c.rules.length > 0) {
		rules = `\u2022 rules ${c.rules.length}`;
	}
	hoverString.appendMarkdown(`${Prereqs} ${targets} ${rules}`);
	hoverString.appendText('\n');
	hoverString.appendMarkdown('**Variations**');
	flag.variations.map((variation, idx) => {
		let offVar = '';
		if (c.offVariation !== undefined && c.offVariation === idx) {
			offVar = `\u25c6 Off Variation`;
		}

		let defVar = '';
		if (c.fallthrough) {
			if (c.fallthrough.variation !== undefined && c.fallthrough.variation === idx) {
				defVar = `\u25c6 Fallthrough Variation`;
			}
		}

		let varName = '';
		if (variation.name) {
			varName = `\u25c6 ${variation.name} `;
		}

		hoverString.appendText('\n');
		if (varName || offVar || defVar) {
			hoverString.appendMarkdown(
				`${idx + 1} ${varName} ${offVar} ${defVar} \u25c6 Return Value: \`${JSON.stringify(variation.value)}\``,
			);
		} else {
			hoverString.appendMarkdown(`${idx + 1} \u25c6 Return Value: \`${JSON.stringify(variation.value)}\``);
		}
		hoverString.appendText('\n');

		//let name = ''
		if (variation.name) {
			varName = `\u25c6 ${variation.name} `;
		}
		let describeStr = '';
		if (variation.description) {
			describeStr = describeStr + variation.description;
		}
		hoverString.appendMarkdown(describeStr);
		hoverString.appendText('\n');
		//hoverString.appendMarkdown(`Return Value: \`${JSON.stringify(variation.value)}\``);
		hoverString.appendText('\n');
	});

	return hoverString;
}

export function isPrecedingCharStringDelimeter(document: TextDocument, position: Position): boolean {
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
