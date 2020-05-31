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
	workspace,
	ConfigurationChangeEvent,
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
import { downloadAndUnzipVSCode } from 'vscode-test';

const STRING_DELIMETERS = ['"', "'", '`'];
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};

export async function register(ctx: ExtensionContext, config: Configuration, api: LaunchDarklyAPI) {
	var flagStore;

	try {
		const flags = await api.getFeatureFlags(config.project, config.env);
		const arrayToObject = (array: Array<FeatureFlag>): Object =>
			array.reduce((obj, item) => {
				obj[item.key] = item;
				return obj;
			}, {});
		let intFlags = arrayToObject(flags);
		flagStore = new FlagStore(config, api, intFlags);
	} catch (err) {
		window.showErrorMessage(err);
	}

	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			await config.reload();
			await flagStore.reload(e);
			await commands.executeCommand('launchdarkly.treeviewrefresh');
		}
	});

	const flagView = new LaunchDarklyTreeViewProvider(api, config, flagStore, ctx);
	if (config.enableFlagExplorer) {
		commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', true);
	}

	window.registerTreeDataProvider('launchdarklyFeatureFlags', flagView);

	ctx.subscriptions.push(
		commands.registerCommand('extension.configureLaunchDarkly', async () => {
			try {
				const configurationMenu = new ConfigurationMenu(config, api);
				await configurationMenu.configure();
				await flagStore.reload();
				await flagView.reload();
				window.showInformationMessage('LaunchDarkly configured successfully');
			} catch (err) {
				console.error(err);
				window.showErrorMessage('An unexpected error occurred, please try again later.');
			}
		}),
		languages.registerCompletionItemProvider(
			LD_MODE,
			new LaunchDarklyCompletionItemProvider(config, flagStore),
			"'",
			'"',
		),
		languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config, flagStore)),
		commands.registerTextEditorCommand('extension.openInLaunchDarkly', async editor => {
			let flagKey = editor.document.getText(
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
				await openFlagInBrowser(config, flagKey, flagStore);
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

	constructor(config: Configuration, flagStore: FlagStore) {
		this.config = config;
		this.flagStore = flagStore;
	}

	public provideHover(document: TextDocument, position: Position): Thenable<Hover> {
		return new Promise(async (resolve, reject) => {
			if (this.config.enableHover) {
				const candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
				try {
					const data =
						(await this.flagStore.getFeatureFlag(candidate)) ||
						(await this.flagStore.getFeatureFlag(kebabCase(candidate)));
					if (data) {
						const env = data.flag.environments[this.config.env];
						const sitePath = env._site.href;
						const browserUrl = url.resolve(this.config.baseUri, sitePath);
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

	constructor(config: Configuration, flagStore: FlagStore) {
		this.config = config;
		this.flagStore = flagStore;
	}

	public provideCompletionItems(document: TextDocument, position: Position): Thenable<CompletionItem[]> {
		if (isPrecedingCharStringDelimeter(document, position)) {
			return new Promise(async resolve => {
				if (this.config.enableAutocomplete) {
					const flags = await this.flagStore.allFlags();
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

export function generateHoverString(flag: FeatureFlag, c: FlagConfiguration, url?: string) {
	const fields = [
		['Name', flag.name],
		['Key', c.key],
		['Enabled', c.on],
		['Default variation', JSON.stringify(c.variations[c.fallthrough.variation], null, 2)],
		['Off variation', JSON.stringify(c.variations[c.offVariation], null, 2)],
		[plural(c.prerequisites.length, 'prerequisite', 'prerequisites')],
		[
			plural(
				c.targets.reduce((acc, curr) => acc + curr.values.length, 0),
				'user target',
				'user targets',
			),
		],
		[plural(c.rules.length, 'rule', 'rules')],
	];
	let hoverString = new MarkdownString(`**LaunchDarkly feature flag**`);
	fields.forEach(field => {
		hoverString = hoverString.appendText('\n' + `${field[0]}`);
		if (field.length == 2) {
			hoverString = hoverString.appendText(`: `);
			hoverString = hoverString.appendCodeblock(`${field[1]}`);
		}
	});
	if (url) {
		hoverString.appendText('\n');
		hoverString = hoverString.appendMarkdown(`[Open in browser](${url})`);
		hoverString.isTrusted = true;
	}
	return hoverString;
}

function plural(count: number, singular: string, plural: string) {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function isPrecedingCharStringDelimeter(document: TextDocument, position: Position) {
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
