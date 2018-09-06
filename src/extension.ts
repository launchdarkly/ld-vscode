'use strict';

import * as vscode from 'vscode';
import * as request from 'request';
import * as url from 'url';
import opn = require('opn');
import { LDStreamProcessor, LDFlagValue, LDOptions } from 'ldclient-node';
import InMemoryFeatureStore = require('ldclient-node/feature_store');
import StreamProcessor = require('ldclient-node/streaming');
import Requestor = require('ldclient-node/requestor');
import { kebabCase } from 'lodash';

const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};
const DATA_KIND = { namespace: 'features' };
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;

//TODO: update LDFeatureStore type to support versioned data kind
let store: any;
let updateProcessor: LDStreamProcessor;

class LaunchDarklyCompletionItemProvider implements vscode.CompletionItemProvider {
	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Thenable<vscode.CompletionItem[]> {
		return new Promise(resolve => {
			store.all(DATA_KIND, flags => {
				resolve(
					Object.keys(flags).map(flag => {
						return new vscode.CompletionItem(flag, vscode.CompletionItemKind.Field);
					}),
				);
			});
		});
	}
}

class LaunchDarklyHoverProvider implements vscode.HoverProvider {
	public provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Thenable<vscode.Hover> {
		return new Promise(resolve => {
			getFlagKeyAtCurrentPosition(document, position, flag => {
				if (flag) {
					let hoverString = `**LaunchDarkly Feature Flag**\n
Key: ${flag.key}\n
On: ${flag.on}\n
Default variation: ${JSON.stringify(flag.variations[flag.fallthrough.variation])}\n
Off variation: ${JSON.stringify(flag.variations[flag.offVariation])}\n
Version number: ${flag.version}\n
Prerequisite count: ${flag.prerequisites.length}\n
Target count: ${flag.targets.length}\n
Rule count: ${flag.rules.length}`;
					resolve(new vscode.Hover(hoverString));
					return;
				}
				resolve();
			});
		});
	}
}

export function activate(ctx: vscode.ExtensionContext) {
	let settings = vscode.workspace.getConfiguration('launchdarkly');
	let sdkKey = settings.get<string>('sdkKey');
	let enableHover = settings.get<boolean>('enableHover');
	let enableAutocomplete = settings.get<boolean>('enableAutocomplete');
	if (sdkKey) {
		if (enableHover || enableAutocomplete) {
			let baseUri = settings.get<string>('baseUri');
			let streamUri = settings.get<string>('streamUri');
			store = InMemoryFeatureStore();
			let config: LDOptions = {
				timeout: 5,
				baseUri: baseUri,
				streamUri: streamUri,
				featureStore: store,
				// noop logger for debug calls
				logger: { debug: () => {} },
			};
			updateProcessor = StreamProcessor(sdkKey, config, Requestor(sdkKey, config));
			updateProcessor.start(function(err) {
				if (err) {
					let errMsg = `[LaunchDarkly] Error retrieving flags.${baseUri != 'https://app.launchdarkly.com' ||
					streamUri != 'https://stream.launchdarkly.com'
						? ' Please make sure your configured base and stream URIs are correct'
						: ''}`;
					vscode.window.showErrorMessage('[LaunchDarkly] Error retrieving flags.');
				} else {
					process.nextTick(function() {
						if (enableAutocomplete) {
							ctx.subscriptions.push(
								vscode.languages.registerCompletionItemProvider(
									LD_MODE,
									new LaunchDarklyCompletionItemProvider(),
									"'",
									'"',
								),
							);
						}
						if (enableHover) {
							ctx.subscriptions.push(vscode.languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider()));
						}
					});
				}
			});
		}
	} else {
		vscode.window.showWarningMessage('[LaunchDarkly] sdkKey is not set. LaunchDarkly language support is unavailable.');
	}

	ctx.subscriptions.push(
		vscode.commands.registerTextEditorCommand('extension.openInLaunchDarkly', editor => {
			let flagKey = editor.document.getText(
				editor.document.getWordRangeAtPosition(editor.selection.anchor, FLAG_KEY_REGEX),
			);
			if (flagKey === '') {
				vscode.window.showErrorMessage(
					'[LaunchDarkly] Error retrieving flag (current cursor position is not a feature flag).',
				);
				return;
			}

			if (!settings.get('accessToken')) {
				vscode.window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
				return;
			}

			let project = getProject(settings);
			if (!project) {
				vscode.window.showErrorMessage('[LaunchDarkly] project is not set.');
				return;
			}

			getFeatureFlag(settings, flagKey, (flag: LDFlagValue) => {
				let baseUri = settings.get<string>('baseUri');
				let env = getEnvironment(settings);
				if (env === '') {
					opn(url.resolve(baseUri, flag.environments[Object.keys(flag.environments)[0]]._site.href));
				} else {
					opn(url.resolve(baseUri, flag.environments[env]._site.href));
				}
			});
		}),
	);
}

export function deactivate() {
	updateProcessor.stop();
}

function getProject(settings: vscode.WorkspaceConfiguration) {
	return settings.get<string>('project');
}

function getEnvironment(settings: vscode.WorkspaceConfiguration) {
	if (settings.get<string>('env')) {
		return settings.get<string>('env');
	}
	vscode.window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	return '';
}

function getFlagKeyAtCurrentPosition(document: vscode.TextDocument, position: vscode.Position, cb: Function) {
	store.all(DATA_KIND, flags => {
		let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
		cb(flags[candidate] || flags[kebabCase(candidate)]);
	});
}

function getFeatureFlag(settings: vscode.WorkspaceConfiguration, flagKey: string, cb: Function) {
	let baseUri = settings.get<string>('baseUri');
	let project = getProject(settings);
	let env = getEnvironment(settings);
	let envParam = env ? '?env=' + env : '';
	let options = {
		url: url.resolve(baseUri, `api/v2/flags/${project}/${flagKey + envParam}`),
		headers: {
			Authorization: settings.get('accessToken'),
		},
	};
	request(options, (error, response, body) => {
		if (!error) {
			if (response.statusCode == 200) {
				cb(JSON.parse(body).environments);
			} else if (response.statusCode == 404) {
				// Try resolving the flag key to kebab case
				options.url = url.resolve(baseUri, `api/v2/flags/${project}/${kebabCase(flagKey) + envParam}`);
				request(options, (error, response, body) => {
					if (!error) {
						if (response.statusCode == 200) {
							cb(JSON.parse(body).environments);
						} else if (response.statusCode == 404) {
							vscode.window.showErrorMessage(`[LaunchDarkly] Flag ${flagKey} not found.`);
							return;
						} else {
							vscode.window.showErrorMessage(response.statusCode);
						}
					} else {
						vscode.window.showErrorMessage(`[LaunchDarkly] Encountered an error retrieving the flag ${flagKey}`);
					}
				});
			} else {
				vscode.window.showErrorMessage(response.statusCode);
			}
		} else {
			vscode.window.showErrorMessage(`[LaunchDarkly] Encountered an error retrieving the flag ${flagKey}`);
		}
		cb(error, response, body);
	});
}
