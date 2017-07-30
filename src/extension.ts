'use strict';

import * as vscode from 'vscode';
import * as request from 'request';

const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};
// 5 minutes
const FLAG_CONFIGS_TTL = 5 * 60 * 1000;
// Global object containing flag configurations. Initialized on activation.
var flags;

class LaunchDarklyCompletionItemProvider
	implements vscode.CompletionItemProvider {
	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Thenable<vscode.CompletionItem[]> {
		if (new Date().getTime() - flags.lastUpdated > FLAG_CONFIGS_TTL) {
			getFlags();
		}
		return flags.map(flag => {
			return new vscode.CompletionItem(flag.key, 4);
		});
	}
}

class LaunchDarklyHoverProvider implements vscode.HoverProvider {
	public provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	): Thenable<vscode.Hover> {
		if (new Date().getTime() - flags.lastUpdated > FLAG_CONFIGS_TTL) {
			getFlags();
		}
		let flag = flags.find(function(flag) {
			return document.getText(
				document.getWordRangeAtPosition(
					position,
					new RegExp(/([\'\"])[a-z0-9\.-_]+\1/, 'i'),
				),
			);
		});
		let env = getEnvironment(vscode.workspace.getConfiguration('launchdarkly'));
		let hoverString =
			'Name: ' +
			flag.name +
			' | Description: ' +
			flag.description +
			' | On: ' +
			flag.environments[env].on +
			' | Default variation: ' +
			flag.variations[flag.environments[env].offVariation].value +
			' | Last modified: ' +
			new Date(flag.environments[env].lastModified);
		return new Promise(resolve => {
			resolve(new vscode.Hover(hoverString));
		});
	}
}

export function activate(ctx: vscode.ExtensionContext) {
	const channel = vscode.window.createOutputChannel('LaunchDarkly');
	flags = getFlags();

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

	ctx.subscriptions.push(
		vscode.commands.registerTextEditorCommand('extension.getFlag', () => {
			let settings = vscode.workspace.getConfiguration('launchdarkly');
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

export function deactivate() {}

function getFlags() {
	let settings = vscode.workspace.getConfiguration('launchdarkly');
	if (!settings.get('accessToken')) {
		vscode.window.showErrorMessage(
			'launchdarkly.accessToken is not set. Unable to load flags.',
		);
		return;
	}

	let project = getProject(settings);
	let envParam = '?env=' + getEnvironment(settings);
	var options = {
		url: 'https://app.launchdarkly.com/api/v2/flags/' + project + envParam,
		headers: {
			Authorization: settings.get('accessToken'),
		},
	};

	request(options, (error, response, body) => {
		if (!error) {
			if (response.statusCode == 200) {
				flags = JSON.parse(body).items;
				flags.lastUpdated = new Date().getTime();
			} else {
				console.log(response);
				vscode.window.showErrorMessage(response.statusCode);
			}
		} else {
			console.log(error);
			vscode.window.showErrorMessage('Encountered an error retrieving flags.');
		}
	});
	return;
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
