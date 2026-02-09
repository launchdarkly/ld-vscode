import { commands, Disposable, ProgressLocation, window } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { CMD_LD_CONNECT_DEV_SERVER, CMD_LD_DISCONNECT_DEV_SERVER, CMD_LD_REFRESH_ENTRY } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { updateDevServerStatusBar } from '../devServerStatusBar';

export function connectDevServerCommand(config: LDExtensionConfiguration): Disposable {
	return registerCommand(CMD_LD_CONNECT_DEV_SERVER, async () => {
		try {
			const devServerUri = config.getConfig().getDevServerUri();

			// Confirm connection with the user
			const confirm = await window.showInformationMessage(
				`Connect to LaunchDarkly dev-server at ${devServerUri}?`,
				{ modal: false },
				'Connect',
				'Change URI',
			);

			if (!confirm) {
				return;
			}

			let finalUri = devServerUri;

			if (confirm === 'Change URI') {
				const inputUri = await window.showInputBox({
					prompt: 'Enter the dev-server URI',
					value: devServerUri,
					placeHolder: 'http://localhost:8765',
					validateInput: (value) => {
						try {
							new URL(value);
							return null;
						} catch {
							return 'Please enter a valid URL';
						}
					},
				});

				if (!inputUri) {
					return;
				}
				finalUri = inputUri;
			}

			// Enable dev-server mode
			config.getConfig().devServerUri = finalUri;
			config.getConfig().setDevServerEnabled(true);

			// Reload the flag store to reconnect with dev-server
			if (config.getFlagStore()) {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: '[LaunchDarkly] Connecting to dev-server...',
						cancellable: false,
					},
					async () => {
						await config.getFlagStore().reload();
					},
				);
			}

			// Update status bar to show dev-server connection
			updateDevServerStatusBar(config);

			// Refresh the flags view to load dev-server values
			await commands.executeCommand(CMD_LD_REFRESH_ENTRY);

			window.showInformationMessage(`Connected to LaunchDarkly dev-server at ${finalUri}`);
		} catch (err) {
			console.error(`Failed to connect to dev-server: ${err}`);
			window.showErrorMessage(`Failed to connect to dev-server: ${err.message}`);
		}
	});
}

export function disconnectDevServerCommand(config: LDExtensionConfiguration): Disposable {
	return registerCommand(CMD_LD_DISCONNECT_DEV_SERVER, async () => {
		try {
			if (!config.getConfig().isDevServerEnabled()) {
				window.showInformationMessage('Not currently connected to a dev-server');
				return;
			}

			// Disable dev-server mode
			config.getConfig().setDevServerEnabled(false);

			// Reload the flag store to reconnect to LaunchDarkly
			if (config.getFlagStore()) {
				await window.withProgress(
					{
						location: ProgressLocation.Notification,
						title: '[LaunchDarkly] Disconnecting from dev-server...',
						cancellable: false,
					},
					async () => {
						await config.getFlagStore().reload();
					},
				);
			}

			// Update status bar to hide dev-server indicator
			updateDevServerStatusBar(config);

			// Refresh the flags view to show LaunchDarkly values
			await commands.executeCommand(CMD_LD_REFRESH_ENTRY);

			window.showInformationMessage('Disconnected from dev-server. Flag values now come from LaunchDarkly.');
		} catch (err) {
			console.error(`Failed to disconnect from dev-server: ${err}`);
			window.showErrorMessage(`Failed to disconnect from dev-server: ${err.message}`);
		}
	});
}
