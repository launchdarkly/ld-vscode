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
} from 'vscode';
import * as url from 'url';
import opn = require('opn');
import { kebabCase } from 'lodash';

import { Configuration } from './configuration';
import { LaunchDarklyAPI } from './api';
import { Environment, FlagConfiguration } from './models';
import { FlagStore } from './flagStore';

const STRING_DELIMETERS = ['"', "'", '`'];
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};

export function register(ctx: ExtensionContext, config: Configuration, flagStore: FlagStore) {
	ctx.subscriptions.push(
		languages.registerCompletionItemProvider(
			LD_MODE,
			new LaunchDarklyCompletionItemProvider(config, flagStore),
			"'",
			'"',
		),
	);

	ctx.subscriptions.push(languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(config, flagStore)));

	ctx.subscriptions.push(
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
				await openFlagInBrowser(config, flagKey);
			} catch (err) {
				let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
				if (err.statusCode == 404) {
					// Try resolving the flag key to kebab case
					try {
						await openFlagInBrowser(config, kebabCase(flagKey));
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
				const flags = await this.flagStore.allFlags();
				let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
				let flag = flags[candidate] || flags[kebabCase(candidate)];
				if (flag) {
					let hover = generateHoverString(flag);
					resolve(new Hover(hover));
					return;
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

const openFlagInBrowser = async (config: Configuration, flagKey: string) => {
	const api = new LaunchDarklyAPI(config);
	const flag = await api.getFeatureFlag(config.project, flagKey, config.env);

	// Default to first environment
	let env: Environment = Object.values(flag.environments)[0];
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

export function generateHoverString(flag: FlagConfiguration) {
	return `**LaunchDarkly feature flag**\n
	Key: ${flag.key}
	Enabled: ${flag.on}
	Default variation: ${JSON.stringify(flag.variations[flag.fallthrough.variation])}
	Off variation: ${JSON.stringify(flag.variations[flag.offVariation])}
	${plural(flag.prerequisites.length, 'prerequisite', 'prerequisites')}
	${plural(
		flag.targets.reduce((acc, curr) => acc + curr.values.length, 0),
		'user target',
		'user targets',
	)}
	${plural(flag.rules.length, 'rule', 'rules')}`;
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
