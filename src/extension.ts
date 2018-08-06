'use strict';

import * as vscode from 'vscode';
import * as request from 'request';
import InMemoryFeatureStore = require('ldclient-node/feature_store');
import StreamProcessor = require('ldclient-node/streaming');
import Requestor = require('ldclient-node/requestor');

const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};
const DATA_KIND = { namespace: 'features' };
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;

var store;
var updateProcessor;

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
			store.all(DATA_KIND, flags => {
				var flag = flags[document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX))];
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
				} else {
					resolve();
				}
			});
		});
	}
}

export function activate(ctx: vscode.ExtensionContext) {
	const channel = vscode.window.createOutputChannel('LaunchDarkly');
	var settings = vscode.workspace.getConfiguration('launchdarkly');
	if (settings.get('sdkKey')) {
		var sdkKey = settings.get('sdkKey');
		store = InMemoryFeatureStore();
		var config = {
			timeout: 5,
			baseUri: 'https://app.launchdarkly.com',
			streamUri: 'https://stream.launchdarkly.com',
			featureStore: store,
			// noop logger for debug calls
			logger: { debug: () => {} },
		};
		updateProcessor = StreamProcessor(sdkKey, config, Requestor(sdkKey, config));
		updateProcessor.start(function(err) {
			if (err) {
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
		vscode.commands.registerTextEditorCommand('extension.getFlag', () => {
			let flag = getFlagFromEditorSelection();
			if (flag === '') {
				vscode.window.showErrorMessage('[LaunchDarkly] Error retrieving flag (no selection made).');
				return;
			}

			if (settings.get('clearOutputBeforeEveryCommand')) {
				channel.clear();
			} else {
				channel.appendLine('Getting flag: ' + flag);
			}

			if (!settings.get('accessToken')) {
				vscode.window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
				return;
			}

			let project = getProject(settings);
			let envParam = '?env=' + getEnvironment(settings);

			var options = {
				url: 'https://app.launchdarkly.com/api/v2/flags/' + project + '/' + flag + envParam,
				headers: {
					Authorization: settings.get('accessToken'),
				},
			};

			request(options, (error, response, body) => {
				if (!error) {
					if (response.statusCode == 200) {
						channel.appendLine(JSON.stringify(JSON.parse(body), null, 2));
						channel.show();
					} else if (response.statusCode == 404) {
						vscode.window.showErrorMessage('[LaunchDarkly] 404 - Flag not found.');
					} else {
						vscode.window.showErrorMessage(response.statusCode);
					}
				} else {
					vscode.window.showErrorMessage('[LaunchDarkly] Encountered an error retrieving flag.');
				}
			});
		}),
	);
}

export function deactivate() {
	updateProcessor.stop();
}

function getFlagFromEditorSelection() {
	let editor = vscode.window.activeTextEditor;
	let selection = editor.selection;
	return editor.document.getText(
		new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character),
	);
}

function getProject(settings) {
	if (settings.get('project')) {
		return settings.get('project');
	} else {
		vscode.window.showWarningMessage("[LaunchDarkly] project is not set, using 'default' project instead.");
		return 'default';
	}
}

function getEnvironment(settings) {
	if (settings.get('env')) {
		return settings.get('env');
	} else {
		vscode.window.showInformationMessage('[LaunchDarkly] env is not set. Showing all environments.');
		return '';
	}
}
