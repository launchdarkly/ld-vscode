'use strict';

import * as vscode from 'vscode';
import * as request from 'request';
import * as StreamProcessor from './streaming';
import * as Requestor from './requestor';
import * as InMemoryFeatureStore from './featureStore';

const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};

var store;
var updateProcessor;

class LaunchDarklyCompletionItemProvider
	implements vscode.CompletionItemProvider {
	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Thenable<vscode.CompletionItem[]> {
		return new Promise(resolve => {
			store.all(flags => {
				resolve(
					Object.keys(flags).map(flag => {
						return new vscode.CompletionItem(flag, 4);
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
			store.all(flags => {
				var flag =
					flags[document.getText(document.getWordRangeAtPosition(position))];
				if (flag) {
					let hoverString =
						'**LaunchDarkly Feature Flag**  \nKey: ' +
						flag.key +
						'  \nOn: ' +
						flag.on +
						'  \nDefault variation: ' +
						flag.variations[flag.fallthrough.variation] +
						'  \nOff variation: ' +
						flag.variations[flag.offVariation] +
						'  \nVersion number: ' +
						flag.version +
						'  \nPrerequisite count: ' +
						flag.prerequisites.length +
						'  \nTarget count: ' +
						flag.targets.length +
						'  \nRule count: ' +
						flag.rules.length;
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
			base_uri: 'https://app.launchdarkly.com',
			stream_uri: 'https://stream.launchdarkly.com',
			feature_store: store,
		};
		updateProcessor = StreamProcessor(
			sdkKey,
			config,
			Requestor(sdkKey, config),
		);
		updateProcessor.start(function(err) {
			if (err) {
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

					ctx.subscriptions.push(
						vscode.languages.registerHoverProvider(
							LD_MODE,
							new LaunchDarklyHoverProvider(),
						),
					);
				});
			}
		});
	} else {
		vscode.window.showWarningMessage(
			'launchdarkly.sdkKey is not set. LaunchDarkly language support is unavailable.',
		);
	}

	ctx.subscriptions.push(
		vscode.commands.registerTextEditorCommand('extension.getFlag', () => {
			let flag = getFlagFromEditorSelection();

			if (flag === '') {
				vscode.window.showErrorMessage(
					'Error retrieving flag (no selection made).',
				);
				return;
			}

			if (settings.get('clearOutputBeforeEveryCommand')) {
				channel.clear();
			} else {
				channel.appendLine('Getting flag: ' + flag);
			}

			if (!settings.get('accessToken')) {
				vscode.window.showErrorMessage('launchdarkly.accessToken is not set');
				return;
			}

			let project = getProject(settings);
			let envParam = '?env=' + getEnvironment(settings);

			var options = {
				url:
					'https://app.launchdarkly.com/api/v2/flags/' +
					project +
					'/' +
					flag +
					envParam,
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
						console.log('404');
						vscode.window.showErrorMessage('404 - Flag not found.');
					} else {
						console.log(response);
						vscode.window.showErrorMessage(response.statusCode);
					}
				} else {
					console.log(error);
					vscode.window.showErrorMessage(
						'Encountered an error retrieving flag.',
					);
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
		new vscode.Range(
			selection.start.line,
			selection.start.character,
			selection.end.line,
			selection.end.character,
		),
	);
}

function getProject(settings) {
	if (settings.get('project')) {
		return settings.get('project');
	} else {
		vscode.window.showWarningMessage(
			"launchdarkly.project is not set, using 'default' project instead",
		);
		return 'default';
	}
}

function getEnvironment(settings) {
	if (settings.get('env')) {
		return settings.get('env');
	} else {
		vscode.window.showInformationMessage(
			'launchdarkly.env is not set. Showing all environments.',
		);
		return '';
	}
}
