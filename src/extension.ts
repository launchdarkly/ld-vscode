'use strict';

import * as vscode from 'vscode';
import * as request from 'request';
import * as url from 'url';
import opn = require('opn');
import { LDStreamProcessor, LDFlagValue, LDOptions } from 'ldclient-node';
import InMemoryFeatureStore = require('ldclient-node/feature_store');
import StreamProcessor = require('ldclient-node/streaming');
import Requestor = require('ldclient-node/requestor');

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
Default variation: ${flag.variations[flag.fallthrough.variation]}\n
Off variation: ${flag.variations[flag.offVariation]}\n
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
	if (sdkKey) {
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
					ctx.subscriptions.push(
						vscode.languages.registerCompletionItemProvider(
							LD_MODE,
							new LaunchDarklyCompletionItemProvider(),
							"'",
							'"',
						),
					);
					ctx.subscriptions.push(vscode.languages.registerHoverProvider(LD_MODE, new LaunchDarklyHoverProvider()));
				});
			}
		});
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
			let env = getEnvironment(settings);
			let envParam = env ? '?env=' + env : '';
			let options = {
				url: url.resolve(settings.get('baseUri'), `api/v2/flags/${project}/${flagKey}${envParam}`),
				headers: {
					Authorization: settings.get('accessToken'),
				},
			};
			request(options, (error, response, body) => {
				if (!error) {
					if (response.statusCode == 200) {
						let environments = JSON.parse(body).environments;
						if (env === '') {
							opn(url.resolve(settings.get('baseUri'), environments[Object.keys(environments)[0]]._site.href));
						} else {
							opn(url.resolve(settings.get('baseUri'), environments[env]._site.href));
						}
					} else if (response.statusCode == 404) {
						vscode.window.showErrorMessage(`[LaunchDarkly] Flag key ${flagKey} not found.`);
					} else {
						vscode.window.showErrorMessage(response.statusCode);
					}
				} else {
					vscode.window.showErrorMessage(`[LaunchDarkly] Encountered an error retrieving the flag ${flagKey}`);
				}
			});
		}),
	);
}

export function deactivate() {
	updateProcessor.stop();
}

function getProject(settings) {
	if (settings.get('project')) {
		return settings.get('project');
	}
	return '';
}

function getEnvironment(settings) {
	if (settings.get('env')) {
		return settings.get('env');
	}
	vscode.window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	return '';
}

function getFlagKeyAtCurrentPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
	cb: Function,
): LDFlagValue {
	store.all(DATA_KIND, flags => {
		let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
		cb(flags[candidate]);
	});
}
