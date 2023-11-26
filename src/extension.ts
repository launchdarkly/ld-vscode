'use strict';

import { commands, window, ExtensionContext, authentication } from 'vscode';
import { access, constants } from 'fs';
import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';
import { CodeRefsDownloader } from './coderefs/codeRefsDownloader';
import { CodeRefs as cr } from './coderefs/codeRefsVersion';
import { LaunchDarklyAuthenticationProvider, LaunchDarklyAuthenticationSession } from './providers/authProvider';
import { extensionReload } from './utils';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';

export async function activate(ctx: ExtensionContext): Promise<void> {
	const LDExtConfig = LDExtensionConfiguration.getInstance();
	LDExtConfig.setCtx(ctx);
	//global.ldContext.ctx = ctx;
	//config = new Configuration(ctx);
	LDExtConfig.setConfig(new Configuration(LDExtConfig.getCtx()));
	await LDExtConfig.getConfig().reload();
	const authProv = new LaunchDarklyAuthenticationProvider(LDExtConfig.getCtx());
	LDExtConfig.getCtx().subscriptions.push(authProv);

	const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false }) as LaunchDarklyAuthenticationSession;
	LDExtConfig.setSession(session);
	//global.ldSession = session;

	const validationError = await LDExtConfig.getConfig().validate();
	const configuredOnce = LDExtConfig.getCtx().globalState.get('LDConfigured');

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
							: LDExtConfig.getCtx().workspaceState.update('isDisabledForWorkspace', true);
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
						: LDExtConfig.getCtx().globalState.update('legacyNotificationDismissed', true);
				});
			break;
	}

	LDExtConfig.getCtx().subscriptions.push(
		commands.registerCommand('vscode-launchdarkly-authprovider.signIn', async () => {
			const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: true }) as LaunchDarklyAuthenticationSession;
			LDExtConfig.setSession(session);
			//global.ldSession = session;
		}),
	);
	authentication.onDidChangeSessions(async (e) => {
		console.dir(e);
		if (e.provider.id === 'launchdarkly') {
			await extensionReload(LDExtConfig);
		}
	});
	LDExtConfig.setApi(new LaunchDarklyAPI(LDExtConfig.getConfig(), LDExtConfig));
	if (validationError !== 'unconfigured') {
		LDExtConfig.setFlagStore(new FlagStore(LDExtConfig));
	}

	const codeRefsVersionDir = `${LDExtConfig.getCtx().asAbsolutePath('coderefs')}/${cr.version}`;
	// Check to see if coderefs is already installed. Need more logic if specific config path is set.
	if (LDExtConfig.getConfig().enableAliases) {
		access(codeRefsVersionDir, constants.F_OK, (err) => {
			if (err) {
				const CodeRefs = new CodeRefsDownloader(LDExtConfig.getCtx(), codeRefsVersionDir);
				CodeRefs.download();
				return;
			}
		});
	}
	try {
		await registerProviders(LDExtConfig);
	} catch (err) {
		console.log(err);
	}
}

export async function deactivate(): Promise<void> {
	global.ldContext.flagStore && global.ldContext.flagStore.stop();
}
