import { StatusBarAlignment, StatusBarItem, ThemeColor, window } from 'vscode';
import { LDExtensionConfiguration } from './ldExtensionConfiguration';
import { CMD_LD_DISCONNECT_DEV_SERVER } from './utils/commands';

let devServerStatusBarItem: StatusBarItem | undefined;

export function createDevServerStatusBar(): StatusBarItem {
	if (!devServerStatusBarItem) {
		devServerStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
		devServerStatusBarItem.command = CMD_LD_DISCONNECT_DEV_SERVER;
	}
	return devServerStatusBarItem;
}

export function updateDevServerStatusBar(config: LDExtensionConfiguration): void {
	if (!devServerStatusBarItem) {
		return;
	}

	if (config.getConfig().isDevServerEnabled()) {
		const uri = config.getConfig().getDevServerUri();
		devServerStatusBarItem.text = `$(debug-disconnect) LD Dev Server`;
		devServerStatusBarItem.tooltip = `Connected to dev-server at ${uri}\nClick to disconnect`;
		devServerStatusBarItem.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
		devServerStatusBarItem.show();
	} else {
		devServerStatusBarItem.hide();
	}
}

export function getDevServerStatusBarItem(): StatusBarItem | undefined {
	return devServerStatusBarItem;
}
