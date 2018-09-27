'use strict';

import * as vscode from 'vscode';
import * as url from 'url';
import opn = require('opn');
import { kebabCase } from 'lodash';

import { LDStreamProcessor, LDFlagValue, LDFeatureStore } from 'ldclient-node';
import InMemoryFeatureStore = require('ldclient-node/feature_store');
import StreamProcessor = require('ldclient-node/streaming');
import Requestor = require('ldclient-node/requestor');

import * as utils from './utils';
import package_json = require('../package.json');

const DATA_KIND = { namespace: 'features' };
const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;
const LD_MODE: vscode.DocumentFilter = {
	scheme: 'file',
};
const STRING_DELIMETERS = ['"', "'", '`'];

let store: LDFeatureStore;
let updateProcessor: LDStreamProcessor;

class LaunchDarklyCompletionItemProvider implements vscode.CompletionItemProvider {
	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Thenable<vscode.CompletionItem[]> {
		const range = document.getWordRangeAtPosition(position, FLAG_KEY_REGEX);
		const c = new vscode.Range(range.start.line, range.start.character - 1, range.start.line, range.start.character);
		if (STRING_DELIMETERS.indexOf(document.getText(c)) >= 0) {
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
}

class LaunchDarklyHoverProvider implements vscode.HoverProvider {
	public provideHover(document: vscode.TextDocument, position: vscode.Position): Thenable<vscode.Hover> {
		return new Promise(resolve => {
			getFlagKeyAtCurrentPosition(document, position, flag => {
				flag ? resolve(new vscode.Hover(utils.generateHoverString(flag))) : resolve();
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
			let config = {
				timeout: 5,
				baseUri: baseUri,
				streamUri: streamUri,
				featureStore: store,
				// noop logger for debug calls
				logger: { debug: () => {} },
				userAgent: 'VSCodeExtension/' + package_json.version,
			};

			updateProcessor = StreamProcessor(sdkKey, config, Requestor(sdkKey, config));
			updateProcessor.start(function(err) {
				if (err) {
					console.log(err);
					let errMsg = `[LaunchDarkly] Unexpected error retrieving flags.${baseUri != 'https://app.launchdarkly.com' ||
					streamUri != 'https://stream.launchdarkly.com'
						? ' Please make sure your configured base and stream URIs are correct'
						: ''}`;
					vscode.window.showErrorMessage(errMsg);
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

			let project = utils.getProject(settings);
			if (!project) {
				vscode.window.showErrorMessage('[LaunchDarkly] project is not set.');
				return;
			}

			utils.getFeatureFlag(settings, flagKey, (flag: LDFlagValue) => {
				let baseUri = settings.get<string>('baseUri');
				let env = utils.getEnvironment(settings);
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

function getFlagKeyAtCurrentPosition(document: vscode.TextDocument, position: vscode.Position, cb: Function) {
	store.all(DATA_KIND, flags => {
		let candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
		cb(flags[candidate] || flags[kebabCase(candidate)]);
	});
}
