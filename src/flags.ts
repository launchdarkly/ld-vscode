import {
	DocumentFilter,
	TextDocument,
	Position,
	Range,
	ConfigurationChangeEvent,
	HoverProvider,
	Hover,
	CompletionItem,
	CompletionItemProvider,
	CompletionItemKind,
	ExtensionContext,
	languages,
	commands,
	window,
} from 'vscode';
import { kebabCase } from 'lodash';
import { LDFeatureStore, LDStreamProcessor } from 'launchdarkly-node-server-sdk';
import InMemoryFeatureStore = require('launchdarkly-node-server-sdk/feature_store');
import StreamProcessor = require('launchdarkly-node-server-sdk/streaming');
import Requestor = require('launchdarkly-node-server-sdk/requestor');
import * as url from 'url';
import opn = require('opn');

import { configuration as config } from './configuration';
import { FlagConfiguration, Environment } from './models';
import { api } from './api';

const package_json = require('../package.json');

const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;

const STRING_DELIMETERS = ['"', "'", '`'];
const DATA_KIND = { namespace: 'features' };
const LD_MODE: DocumentFilter = {
	scheme: 'file',
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

async function openFlagInBrowser(key: string) {
	const flag = await api.getFeatureFlag(config.project, key, config.env);

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
}

class FlagStore {
	store: LDFeatureStore;
	updateProcessor: LDStreamProcessor;

	constructor() {
		this.store = InMemoryFeatureStore();
		this.start();
	}

	reload(e: ConfigurationChangeEvent) {
		if (['sdkKey', 'baseUri', 'streamUri'].some(option => e.affectsConfiguration(`launchdarkly.${option}`))) {
			this.stop();
			this.start();
		}
	}

	start() {
		if (!config.sdkKey || !config.baseUri || !config.streamUri) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return;
		}

		const ldConfig = this.ldConfig();
		this.updateProcessor = StreamProcessor(config.sdkKey, ldConfig, Requestor(config.sdkKey, ldConfig));
		this.updateProcessor.start(err => {
			if (err) {
				let errMsg: string;
				if (err.message) {
					errMsg = `Error retrieving feature flags: ${err.message}.`;
				} else {
					console.error(err);
					errMsg = `Unexpected error retrieving flags.`;
				}
				window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
			}
			process.nextTick(function() {});
		});
	}

	stop() {
		this.updateProcessor && this.updateProcessor.stop();
		this.store.init({}, () => {});
	}

	private ldConfig(): any {
		return {
			timeout: 5,
			baseUri: config.baseUri,
			streamUri: config.streamUri,
			featureStore: this.store,
			logger: {
				debug: console.log,
				warn: console.warn,
				error: console.error,
			},
			userAgent: 'VSCodeExtension/' + package_json.version,
		};
	}

	registerProviders(ctx: ExtensionContext) {
		ctx.subscriptions.push(
			languages.registerCompletionItemProvider(LD_MODE, new LaunchDarklyCompletionItemProvider(this.store), "'", '"'),
		);

		ctx.subscriptions.push(languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider(this.store)));

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
					await openFlagInBrowser(flagKey);
				} catch (err) {
					let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
					if (err.statusCode == 404) {
						// Try resolving the flag key to kebab case
						try {
							await openFlagInBrowser(kebabCase(flagKey));
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
}

export const flagStore = new FlagStore();

class LaunchDarklyHoverProvider implements HoverProvider {
	store: LDFeatureStore;

	constructor(store: LDFeatureStore) {
		this.store = store;
	}

	public provideHover(document: TextDocument, position: Position): Thenable<Hover> {
		return new Promise((resolve, reject) => {
			config.enableHover
				? this.store.all(DATA_KIND, flags => {
						let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
						let flag = flags[candidate] || flags[kebabCase(candidate)];
						if (flag) {
							let hover = generateHoverString(flag);
							resolve(new Hover(hover));
							return;
						}
						reject();
				  })
				: reject();
		});
	}
}

class LaunchDarklyCompletionItemProvider implements CompletionItemProvider {
	store: LDFeatureStore;

	constructor(store: LDFeatureStore) {
		this.store = store;
	}

	public provideCompletionItems(document: TextDocument, position: Position): Thenable<CompletionItem[]> {
		if (isPrecedingCharStringDelimeter(document, position)) {
			return new Promise(resolve => {
				config.enableAutocomplete
					? this.store.all(DATA_KIND, flags => {
							resolve(
								Object.keys(flags).map(flag => {
									return new CompletionItem(flag, CompletionItemKind.Field);
								}),
							);
					  })
					: resolve();
			});
		}
	}
}
