'use strict';

import { commands, window, ExtensionContext, authentication } from 'vscode';
import { access, constants } from 'fs';
import { FlagStore } from './flagStore';
import { Configuration } from './configuration';
import { register as registerProviders } from './providers';
import { LaunchDarklyAPI } from './api';
import { CodeRefsDownloader } from './coderefs/codeRefsDownloader';
import { CodeRefs as cr } from './coderefs/codeRefsVersion';
import { LaunchDarklyAuthenticationProvider } from './providers/authProvider';
import { extensionReload } from './generalUtils';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
import * as semver from 'semver';
import { SetWorkspaceCmd } from './commands/setWorkspaceEnabled';
import { CMD_LD_CONFIG, CMD_LD_SIGNIN } from './utils/commands';
import { ILaunchDarklyAuthenticationSession } from './models';

export async function activate(ctx: ExtensionContext): Promise<void> {
	const storedVersion = ctx.globalState.get('version', '5.0.0');
	const LDExtConfig = LDExtensionConfiguration.getInstance(ctx);
	LDExtConfig.setConfig(new Configuration(LDExtConfig.getCtx()));
	await LDExtConfig.getConfig().reload();
	const authProv = new LaunchDarklyAuthenticationProvider(LDExtConfig.getCtx());
	LDExtConfig.getCtx().subscriptions.push(authProv);

	const session = (await authentication.getSession('launchdarkly', ['writer'], {
		createIfNone: false,
	})) as ILaunchDarklyAuthenticationSession;
	LDExtConfig.setSession(session);

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
							? commands.executeCommand(CMD_LD_CONFIG)
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
						? commands.executeCommand(CMD_LD_CONFIG)
						: LDExtConfig.getCtx().globalState.update('legacyNotificationDismissed', true);
				});
			break;
		default:
			break;
	}

	LDExtConfig.getCtx().subscriptions.push(
		commands.registerCommand(CMD_LD_SIGNIN, async () => {
			const session = (await authentication.getSession('launchdarkly', ['writer'], {
				createIfNone: true,
			})) as ILaunchDarklyAuthenticationSession;
			LDExtConfig.setSession(session);
			if (!(await LDExtConfig.getConfig().isConfigured())) {
				window
					.showInformationMessage(`Click Configure below to finish setting up the LaunchDarkly extension`, `Configure`)
					.then((item) => {
						item === 'Configure' ? commands.executeCommand(CMD_LD_CONFIG) : null;
					});
			} else {
				window.showInformationMessage(`You are now signed in to LaunchDarkly & Project is configured.`);
			}
		}),
		SetWorkspaceCmd(LDExtConfig),
	);
	authentication.onDidChangeSessions(async (e) => {
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
	if (LDExtConfig.getConfig()?.enableAliases) {
		access(codeRefsVersionDir, constants.F_OK, (err) => {
			if (err) {
				const CodeRefs = new CodeRefsDownloader(LDExtConfig.getCtx(), codeRefsVersionDir);
				CodeRefs.download();
				return;
			}
		});
	}

	if (
		((await ctx.secrets.get('launchdarkly_accessToken')) || semver.lt(storedVersion, '4.99.10')) &&
		session === undefined
	) {
		//if (semver.lt(storedVersion, '4.99.1')) {
		window
			.showInformationMessage(
				`LaunchDarkly: Please [Sign In](command:vscode-launchdarkly-authprovider.signIn) as part your extension update.`,
				`Sign In`,
			)
			.then(async (item) => {
				switch (item) {
					case 'Sign In':
						commands.executeCommand(CMD_LD_SIGNIN);
						break;
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
