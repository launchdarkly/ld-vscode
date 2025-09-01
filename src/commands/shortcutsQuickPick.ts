import { ILDExtensionConfiguration } from '../models';
import { Disposable, env, ThemeIcon, Uri, window } from 'vscode';
import { CMD_LD_SHORTCUTS } from '../utils/commands';
import { registerCommand } from '../utils/registerCommand';
import { filtersObjToQueryString } from '../utils/common';

export default function shortcutsQuickPickCmd(config: ILDExtensionConfiguration): Disposable {
	const shortcutsCmd = registerCommand(CMD_LD_SHORTCUTS, async () => {
		const shortcuts = await config.getApi().getShortcuts(config.getConfig().project);
		// Prepare the Quick Pick items
		const quickPickItems = shortcuts.map((shortcut) => {
			const queryString = filtersObjToQueryString(shortcut.filters.filter);
			const sortString = shortcut.filters.sort ? `&sort=${shortcut.filters.sort}` : '';
			const baseUrl = `${config.getSession().fullUri}/projects/${shortcut.context.projectKey}/${shortcut.type}`;
			const envs = shortcut.context.environmentKeys.map((env) => `&env=${env}`).join('');
			const link = `${baseUrl}${queryString}${sortString}&selected-env=${shortcut.context.selectedEnvironmentKey}${envs}&utm_source=vscode`;

			return {
				label: shortcut.name,
				value: link,
				iconPath: new ThemeIcon(`launchdarkly-${shortcut.icon}`),
			};
		});
		if (quickPickItems.length === 0) {
			window.showInformationMessage('[LaunchDarkly] No shortcuts found');
			return;
		}
		// Show the Quick Pick
		const selected = await window.showQuickPick(quickPickItems, {
			placeHolder: 'Select a dashboard shortcut to open in the browser',
		});

		if (selected) {
			// Handle the selected item
			env.openExternal(Uri.parse(selected.value));
		}
	});

	return shortcutsCmd;
}
