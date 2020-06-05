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
	FileChangeType,
	DebugConsoleMode,
} from 'vscode';
import * as url from 'url';
import opn = require('opn');
import { kebabCase } from 'lodash';

import { Configuration } from './configuration';
import { ConfigurationMenu } from './configurationMenu';
import { LaunchDarklyAPI } from './api';
import { FeatureFlag, FlagConfiguration, FeatureFlagConfig } from './models';
import { FlagStore, FlagMap } from './flagStore';
import { LaunchDarklyTreeViewProvider } from './providers/flagsView';

const STRING_DELIMETERS = ['"', "'", '`'];
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;
const LD_MODE: DocumentFilter = {
	scheme: 'file',
};

export async function register(ctx: ExtensionContext, config: Configuration, api: LaunchDarklyAPI) {
	var flagStore;

	try {
		const flags = await api.getFeatureFlags(config.project, config.env);
		const arrayToObject = (array: Array<FeatureFlag>) =>
			array.reduce((obj: { [key: string]: FeatureFlag }, item):  { [key: string]: FeatureFlag } => {
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

			// try {
			// 	await openFlagInBrowser(config, flagKey, flagStore);
			// } catch (err) {
			// 	let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
			// 	if (err.statusCode == 404) {
			// 		// Try resolving the flag key to kebab case
			// 		try {
			// 			await openFlagInBrowser(config, kebabCase(flagKey), flagStore);
			// 			return;
			// 		} catch (err) {
			// 			if (err.statusCode == 404) {
			// 				errMsg = `Could not find the flag ${flagKey}`;
			// 			}
			// 		}
			// 	}
			// 	console.error(err);
			// 	window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			// }
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
				console.log(`candidate: ${candidate}`)
				try {
					const data = await this.flagStore.getFeatureFlag(candidate) //||
						//(await this.flagStore.getFeatureFlag(kebabCase(candidate)));
					console.log(`data: ${data.key}`)
					if (data) {
						console.log(`wtf: ${JSON.stringify(data)}`)
						console.log(this.config.env)
						const env = data.environments[this.config.env];
						console.log(`Env: ${JSON.stringify(env)}`)
						const sitePath = env._site.href;
						const browserUrl = url.resolve(this.config.baseUri, sitePath);
						//console.log(`provider: ${data[env]}`)
						const hover = generateHoverString(JSON.parse(JSON.stringify(data)), this.config.env, browserUrl);
						resolve(new Hover(hover));
						return;
					} else {
						console.log("no data")
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

// const openFlagInBrowser = async (config: Configuration, flagKey: string, flagStore: FlagStore) => {
// 	const flag = await flagStore.getFeatureFlag(flagKey);

// 	// Default to first environment
// 	let env = Object.values(flag.environments);
// 	let sitePath = env._site.href;

// 	if (!config.env) {
// 		window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
// 	} else if (!flag.environments[config.env]) {
// 		window.showWarningMessage(
// 			`[LaunchDarkly] Configured environment '${config.env}' has been deleted. Falling back to first environment.`,
// 		);
// 	} else {
// 		env = flag.environments[config.env];
// 		sitePath = env._site.href;
// 	}
// 	opn(url.resolve(config.baseUri, sitePath));
// };

export function generateHoverString(flag: FeatureFlag, env: string, url?: string) {
	var curEnv = flag.environments[env]
	const fields = [
		['Name', flag.name],
		['Key', flag.key],
		['Enabled', curEnv.on],
		['Default variation', JSON.stringify(flag.variations[curEnv.fallthrough.variation], null, 2)],
		['Off variation', JSON.stringify(flag.variations[curEnv.offVariation], null, 2)],
		[plural(curEnv.prerequisites.length, 'prerequisite', 'prerequisites')],
		[
			plural(
				curEnv.targets.reduce((acc, curr) => acc + curr.values.length, 0),
				'user target',
				'user targets',
			),
		],
		[plural(curEnv.rules.length, 'rule', 'rules')],
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
	console.log(hoverString)
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
