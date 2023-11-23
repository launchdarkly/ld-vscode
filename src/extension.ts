'use strict';

import { commands, window, ExtensionContext } from 'vscode';
import { access, constants } from 'fs';
import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';
import { CodeRefsDownloader } from './coderefs/codeRefsDownloader';
import { CodeRefs as cr } from './coderefs/codeRefsVersion';
import { YamlReader } from './utils/rulesYaml';

let config: Configuration;
let flagStore: FlagStore;

export async function activate(ctx: ExtensionContext): Promise<void> {
	global.ldContext = ctx;
	config = new Configuration(ctx);
	await config.reload();
	const validationError = await config.validate();
	const configuredOnce = ctx.globalState.get('LDConfigured');
	switch (validationError) {
		case 'unconfigured':
			if (window.activeTextEditor !== undefined && configuredOnce !== true) {
				window
					.showInformationMessage(
						`To enable the LaunchDarkly extension, select your desired environment. If this message is dismissed, LaunchDarkly will be disabled for the workspace`,
						'Configure',
					)
					.then((item) => {
						item === 'Configure'
							? commands.executeCommand('extension.configureLaunchDarkly')
							: ctx.workspaceState.update('isDisabledForWorkspace', true);
					});
			}
			break;
		case 'legacy':
			window
				.showWarningMessage(
					'Your LaunchDarkly extension configuration has been deprecated and may not work correctly. Please reconfigure the extension.',
					'Configure',
				)
				.then((item) => {
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

	const codeRefsVersionDir = `${ctx.asAbsolutePath('coderefs')}/${cr.version}`;
	// Check to see if coderefs is already installed. Need more logic if specific config path is set.
	if (config.enableAliases) {
		access(codeRefsVersionDir, constants.F_OK, (err) => {
			if (err) {
				const CodeRefs = new CodeRefsDownloader(ctx, codeRefsVersionDir);
				CodeRefs.download();
				return;
			}
		});
	}

	try {
		await registerProviders(ctx, config, flagStore, api);
	} catch (err) {
		console.log(err);
	}

	

	const data = YamlReader.read('/Users/daniel/.launchdarkly/rules.yaml');
	console.log(data);
}

export async function deactivate(): Promise<void> {
	flagStore && flagStore.stop();
}
