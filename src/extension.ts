'use strict';

import * as vscode from 'vscode';

import { LDFlagManager } from './flags';
import { configuration as settings } from './configuration';

// Handles changes in vscode configuration and registration of commands/providers
let flagManager: LDFlagManager;

export function activate(ctx: vscode.ExtensionContext) {
	vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			console.log("CHANGED A SETTING")
			settings.reload();
			flagManager.reload(settings);
		}
	});

	flagManager = new LDFlagManager(ctx, settings);
	flagManager.registerProviders(ctx, settings);
}

export function deactivate() {
	flagManager.updateProcessor.stop();
}
