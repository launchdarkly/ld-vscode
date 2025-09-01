import { ChatVariableLevel, ChatVariableValue, QuickPickItemKind, window } from 'vscode';
//import { ToggleCache } from '../toggleCache';
import { FlagQuickPickItem } from './selectRule';
import { ToggleCache } from '../toggleCache';
import yaml from 'js-yaml';
import { ILDExtensionConfiguration } from '../models';

const cache = new ToggleCache();

export default async function flagVariableCmd(config: ILDExtensionConfiguration): Promise<ChatVariableValue[]> {
	//const selectRuleCmd = commands.registerCommand('launchdarkly.chooseFlag', async () => {
	const flags = await config.getFlagStore()?.allFlagsMetadata();
	if (flags === undefined) {
		// Errors would be handled in the flagStore
		return;
	}
	const items: Array<{ label: string; kind: QuickPickItemKind } | FlagQuickPickItem> = [];
	const cacheResult = cache.get();
	const cachedFlags = cacheResult ? Array.from(cacheResult).reverse() : [];
	if (cachedFlags?.length > 0) {
		items.push({
			label: 'Recently updated Feature Flags',
			kind: QuickPickItemKind.Separator,
		});
		cachedFlags.forEach((flag) => {
			items.push({
				label: flags[flag].name,
				description: flags[flag].key,
				detail: flags[flag].description,
				value: flags[flag].key,
			});
		});

		items.push({
			label: 'Feature Flag List',
			kind: QuickPickItemKind.Separator,
		});
	}
	Object.keys(flags).forEach((flag) =>
		items.push({
			label: flags[flag].name,
			description: flags[flag].key,
			detail: flags[flag].description,
			value: flags[flag].key,
		}),
	);

	const flagWindow = (await window.showQuickPick(items, {
		title: 'Select Feature Flag',
		placeHolder: 'Type flag key',
		matchOnDescription: true,
		ignoreFocusOut: true,
	})) as FlagQuickPickItem;
	if (!flagWindow) {
		return;
	}

	const flagData = flags[flagWindow.value];

	const data = {
		level: ChatVariableLevel.Full,
		value: flagData.name,
		description: yaml.dump(flagData),
	};
	console.dir(data);
	return [data];
}
