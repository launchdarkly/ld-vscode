'use strict';

import { commands, window, workspace, ExtensionContext, ConfigurationChangeEvent } from 'vscode';
import { access, constants } from 'fs';
import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';
import { CodeRefsDownloader } from './coderefs/codeRefsDownloader';
import { CodeRefs } from './coderefs/codeRefsVersion';
// eslint-disable-next-line @typescript-eslint/no-var-requires

let config: Configuration;
let flagStore: FlagStore;

export async function activate(ctx: ExtensionContext): Promise<void> {
	config = new Configuration(ctx);
	const validationError = config.validate();
	switch (validationError) {
		case 'unconfigured':
			window
				.showInformationMessage('To enable the LaunchDarkly extension, select your desired environment.', 'Configure')
				.then(item => item && commands.executeCommand('extension.configureLaunchDarkly'));
			break;
		case 'legacy':
			window
				.showWarningMessage(
					'Your LaunchDarkly extension configuration has been deprecated and may not work correctly. Please reconfigure the extension.',
					'Configure',
				)
				.then(item => {
					item === 'Configure'
						? commands.executeCommand('extension.configureLaunchDarkly')
						: ctx.globalState.update('legacyNotificationDismissed', true);
				});
			break;
	}

	const api = new LaunchDarklyAPI(config);
	let flagStore: FlagStore;
	if (validationError !== 'unconfigured') {
		flagStore = new FlagStore(config, api);
	}

	// Handle manual changes to extension configuration
	workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
		if (e.affectsConfiguration('launchdarkly')) {
			await config.reload();
			if (!flagStore) {
				const newApi = new LaunchDarklyAPI(config);
				flagStore = new FlagStore(config, newApi);
			}
			await flagStore.reload(e);
		}
	});
	const codeRefsVersionDir = `${ctx.asAbsolutePath('coderefs')}/${CodeRefs.version}`;
	// Check to see if coderefs is already installed. Need more logic if specific config path is set.
	access(codeRefsVersionDir, constants.F_OK, err => {
		if (err) {
			const CodeRefs = new CodeRefsDownloader(ctx, codeRefsVersionDir);
			CodeRefs.download();
			return;
		}
	});

	registerProviders(ctx, config, flagStore, api);
}

export function deactivate(): void {
	flagStore && flagStore.stop();
}
