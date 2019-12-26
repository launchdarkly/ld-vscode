import * as vscode from 'vscode';
import * as request from 'request';
import { kebabCase } from 'lodash';
import { LDFlagValue, LDFeatureStore, LDStreamProcessor } from 'ldclient-node';
import InMemoryFeatureStore = require('ldclient-node/feature_store');
import StreamProcessor = require('ldclient-node/streaming');
import Requestor = require('ldclient-node/requestor');
import * as url from 'url';
import opn = require('opn');

import { IConfiguration, DEFAULT_BASE_URI, DEFAULT_STREAM_URI } from './configuration';
const package_json = require('../package.json');

const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;

const STRING_DELIMETERS = ['"', "'", '`'];
const DATA_KIND = { namespace: 'features' };
const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};

function unexpectedError(flagKey: string) {
	return vscode.window.showErrorMessage(
		`[LaunchDarkly] Encountered an unexpected error retrieving the flag ${flagKey}`,
	);
}

function getFeatureFlag(settings: IConfiguration, flagKey: string, cb: Function) {
	let envParam = settings.env ? '?env=' + settings.env : '';
	let options = {
		url: url.resolve(settings.baseUri, `api/v2/flags/${settings.project}/${flagKey + envParam}`),
		headers: {
			Authorization: settings.accessToken,
		},
	};
	request(options, (error, response, body) => {
		if (!error) {
			if (response.statusCode == 200) {
				cb(JSON.parse(body));
			} else if (response.statusCode == 404) {
				// Try resolving the flag key to kebab case
				options.url = url.resolve(
					settings.baseUri,
					`api/v2/flags/${settings.project}/${kebabCase(flagKey) + envParam}`,
				);
				request(options, (error, response, body) => {
					if (!error) {
						if (response.statusCode == 200) {
							cb(JSON.parse(body));
						} else if (response.statusCode == 404) {
							vscode.window.showErrorMessage(`[LaunchDarkly] Could not find the flag ${flagKey}`);
							return;
						} else {
							unexpectedError(flagKey);
						}
					} else {
						unexpectedError(flagKey);
					}
				});
			} else {
				vscode.window.showErrorMessage(response.statusCode);
			}
		} else {
			unexpectedError(flagKey);
		}
	});
}

export function generateHoverString(flag: LDFlagValue) {
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

export function isPrecedingCharStringDelimeter(document: vscode.TextDocument, position: vscode.Position) {
	const range = document.getWordRangeAtPosition(position, FLAG_KEY_REGEX);

	const c = new vscode.Range(
		range.start.line,
		candidateTextStartLocation(range.start.character),
		range.start.line,
		range.start.character,
	);
	const candidate = document.getText(c).trim();
	return STRING_DELIMETERS.indexOf(candidate) >= 0;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);

interface IFlagManager {
	store: LDFeatureStore;
	updateProcessor: LDStreamProcessor;
}

export class LDFlagManager implements IFlagManager {
	store = InMemoryFeatureStore();
	updateProcessor: LDStreamProcessor;
	private settings: IConfiguration;

	constructor(ctx: vscode.ExtensionContext, settings: IConfiguration) {
		this.settings = Object.assign({}, settings);
		let config = this.config(settings);
		if (settings.sdkKey) {
			this.updateProcessor = StreamProcessor(settings.sdkKey, config, Requestor(settings.sdkKey, config));
			this.start();
		} else {
			vscode.window.showWarningMessage(
				'[LaunchDarkly] sdkKey is not set. LaunchDarkly language support is unavailable.',
			);
		}
	}

	start() {
		this.updateProcessor &&
			this.updateProcessor.start(function(err) {
				if (err) {
					console.log(err);
					let errMsg = `[LaunchDarkly] Unexpected error retrieving flags.${
						this.settings.baseUri != DEFAULT_BASE_URI || this.settings.streamUri != DEFAULT_STREAM_URI
							? ' Please make sure your configured base and stream URIs are correct'
							: ''
					}`;
					vscode.window.showErrorMessage(errMsg);
				} else {
					process.nextTick(function() {});
				}
			});
	}

	reload(newSettings: IConfiguration) {
		if (
			this.settings.sdkKey !== newSettings.sdkKey ||
			this.settings.baseUri !== newSettings.baseUri ||
			this.settings.streamUri !== newSettings.streamUri
		) {
			let config = this.config(newSettings);
			this.updateProcessor && this.updateProcessor.stop();
			this.updateProcessor = StreamProcessor(newSettings.sdkKey, config, Requestor(newSettings.sdkKey, config));
			this.start();
		}
		this.settings = newSettings;
	}

	config(settings: IConfiguration): any {
		return {
			timeout: 5,
			baseUri: settings.baseUri,
			streamUri: settings.streamUri,
			featureStore: this.store,
			logger: {
				debug: msg => {
					console.log(msg);
				},
			},
			userAgent: 'VSCodeExtension/' + package_json.version,
		};
	}

	registerProviders(ctx: vscode.ExtensionContext, settings: IConfiguration) {
		ctx.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(LD_MODE, new this.LaunchDarklyCompletionItemProvider(), "'", '"'),
		);

		ctx.subscriptions.push(vscode.languages.registerHoverProvider(LD_MODE, new this.LaunchDarklyHoverProvider()));

		ctx.subscriptions.push(
			vscode.commands.registerTextEditorCommand('extension.openInLaunchDarkly', editor => {
				let flagKey = editor.document.getText(
					editor.document.getWordRangeAtPosition(editor.selection.anchor, FLAG_KEY_REGEX),
				);
				if (!flagKey) {
					vscode.window.showErrorMessage(
						'[LaunchDarkly] Error retrieving flag (current cursor position is not a feature flag).',
					);
					return;
				}

				if (!settings.accessToken) {
					vscode.window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
					return;
				}

				if (!settings.project) {
					vscode.window.showErrorMessage('[LaunchDarkly] project is not set.');
					return;
				}

				getFeatureFlag(settings, flagKey, (flag: LDFlagValue) => {
					if (!settings.env) {
						vscode.window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
						opn(url.resolve(settings.baseUri, flag.environments[Object.keys(flag.environments)[0]]._site.href));
					} else {
						opn(url.resolve(settings.baseUri, flag.environments[settings.env]._site.href));
					}
				});
			}),
		);
	}

	get LaunchDarklyHoverProvider() {
		const settings = this.settings;
		const store = this.store;
		return class LaunchDarklyHoverProvider implements vscode.HoverProvider {
			public provideHover(document: vscode.TextDocument, position: vscode.Position): Thenable<vscode.Hover> {
				return new Promise((resolve, reject) => {
					settings.enableHover
						? store.all(DATA_KIND, flags => {
								let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
								let flag = flags[candidate] || flags[kebabCase(candidate)];
								if (flag) {
									let hover = generateHoverString(flag);
									resolve(new vscode.Hover(hover));
									return;
								}
								reject();
						  })
						: reject();
				});
			}
		};
	}

	get LaunchDarklyCompletionItemProvider() {
		const settings = this.settings;
		const store = this.store;
		return class LaunchDarklyCompletionItemProvider implements vscode.CompletionItemProvider {
			public provideCompletionItems(
				document: vscode.TextDocument,
				position: vscode.Position,
			): Thenable<vscode.CompletionItem[]> {
				if (isPrecedingCharStringDelimeter(document, position)) {
					return new Promise(resolve => {
						settings.enableAutocomplete
							? store.all(DATA_KIND, flags => {
									resolve(
										Object.keys(flags).map(flag => {
											return new vscode.CompletionItem(flag, vscode.CompletionItemKind.Field);
										}),
									);
							  })
							: resolve();
					});
				}
			}
		};
	}
}
