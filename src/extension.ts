'use strict';

import * as vscode from 'vscode';
import * as request from 'request';

const channel = vscode.window.createOutputChannel('LaunchDarkly');

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerTextEditorCommand(
		'extension.getFlag',
		() => {
			let settings = vscode.workspace.getConfiguration('launchdarkly');
			if (settings.get('clearOutputBeforeEveryCommand')) {
				channel.clear();
			}
			if (!settings.get('accessToken')) {
				vscode.window.showErrorMessage(
					'launchdarkly.accessToken is not set in settings.json',
				);
				return;
			}
			let project = 'default';
			let env = '';
			if (settings.get('project')) {
				project = settings.get('project');
			} else {
				vscode.window.showWarningMessage(
					"launchdarkly.project is not set in settings.json, using 'default' project instead",
				);
			}
			if (settings.get('env')) {
				env = '?env=' + settings.get('env');
			} else {
				vscode.window.showInformationMessage(
					'launchdarkly.env is not set in settings.json. Showing all environments.',
				);
			}
			let editor = vscode.window.activeTextEditor;
			let selection = editor.selection;
			let flag = editor.document.getText(
				new vscode.Range(
					selection.start.line,
					selection.start.character,
					selection.end.line,
					selection.end.character,
				),
			);

			if (flag === '') {
				vscode.window.showErrorMessage(
					'launchdarkly.accessToken is not defined in settings.json',
				);
				return;
			}

			var options = {
				url:
					'https://app.launchdarkly.com/api/v2/flags/' +
					project +
					'/' +
					flag +
					env,
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
		},
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}
