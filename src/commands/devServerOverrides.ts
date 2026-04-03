import { ILDExtensionConfiguration } from '../models';
import { commands, window } from 'vscode';
import { showSmartOverrideInput } from '../utils/smartOverrideInput';
import { analytics } from '../analytics';

export async function setDevServerOverride(config: ILDExtensionConfiguration, flagKey: string): Promise<void> {
	const devServerProvider = config.getDevServerProvider();
	if (!devServerProvider || !config.getConfig().isDevServerEnabled()) {
		window.showErrorMessage('Not connected to dev-server');
		return;
	}

	// Get flag info with variations
	const flagInfo = devServerProvider.getFlag(flagKey);
	if (!flagInfo) {
		window.showErrorMessage('Flag not found in dev-server');
		return;
	}

	// Always show current value (override if it exists, otherwise base value)
	const currentValue = (flagInfo.override?.value ?? flagInfo.flag.value) as
		| string
		| number
		| boolean
		| object
		| undefined;
	const isEditing = flagInfo.isOverridden;

	// Show smart input based on flag type
	const value = await showSmartOverrideInput(flagInfo.flag, currentValue, isEditing);

	if (value === undefined) {
		return;
	}

	try {
		const success = await devServerProvider.setOverride(flagKey, value);

		if (success) {
			analytics.track('dev-server-override-set', { flagKey, isEditing });
			window.showInformationMessage(`${isEditing ? 'Updated' : 'Set'} dev-server override for flag "${flagKey}"`);
			await commands.executeCommand('launchdarkly.refreshEntry');
		} else {
			window.showErrorMessage(`Failed to ${isEditing ? 'update' : 'set'} override`);
		}
	} catch (err) {
		window.showErrorMessage(`Failed to ${isEditing ? 'update' : 'set'} override: ${err.message}`);
	}
}

export async function removeDevServerOverride(config: ILDExtensionConfiguration, flagKey: string): Promise<void> {
	const devServerProvider = config.getDevServerProvider();
	if (!devServerProvider || !config.getConfig().isDevServerEnabled()) {
		window.showErrorMessage('Not connected to dev-server');
		return;
	}

	const confirm = await window.showWarningMessage(
		`Remove dev-server override for flag "${flagKey}"?`,
		{ modal: true },
		'Remove',
	);

	if (confirm !== 'Remove') {
		return;
	}

	try {
		const success = await devServerProvider.removeOverride(flagKey);

		if (success) {
			analytics.track('dev-server-override-removed', { flagKey });
			window.showInformationMessage(`Removed dev-server override for flag "${flagKey}"`);
			await commands.executeCommand('launchdarkly.refreshEntry');
		} else {
			window.showErrorMessage('Failed to remove override');
		}
	} catch (err) {
		window.showErrorMessage(`Failed to remove override: ${err.message}`);
	}
}
