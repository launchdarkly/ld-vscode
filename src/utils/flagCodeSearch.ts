import { commands } from 'vscode';
import { ILDExtensionConfiguration } from '../models';

export function flagCodeSearch(config: ILDExtensionConfiguration, key: string) {
	let aliases;
	let findAliases: string;
	if (config.getAliases()) {
		aliases = config.getAliases()?.getKeys();
	}
	if (aliases && aliases[key]) {
		const tempSearch = [...aliases[key]];
		tempSearch.push(key);
		findAliases = tempSearch.join('|');
	} else {
		findAliases = key;
	}
	commands.executeCommand('workbench.action.findInFiles', {
		query: findAliases,
		triggerSearch: true,
		matchWholeWord: true,
		isCaseSensitive: true,
		isRegex: true,
	});
}
