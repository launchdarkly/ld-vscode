import { QuickPickItemKind, window } from 'vscode';
import { FlagQuickPickItem } from '../commands/selectRule';
import { ILDExtensionConfiguration, RuleSelection } from '../models';
import { ToggleCache } from '../toggleCache';

const RECENT_FLAGS = 'Recently updated Feature Flags';
const FLAG_FOR_RULE = 'Select Feature Flag for rule';
const FLAG_LIST = 'Feature Flag List';
const SEARCH_FLAG = 'Type flag key or name to search';

export default async function showFeatureFlagsQuickPick(config: ILDExtensionConfiguration, cache: ToggleCache) {
	const flags = await config.getFlagStore()?.allFlagsMetadata();
	if (flags === undefined) {
		// Errors would be handled in the flagStore
		return;
	}
	const items: Array<RuleSelection | { label: string; kind: QuickPickItemKind } | FlagQuickPickItem> = [];
	const cacheResult = cache.get();
	const cachedFlags = cacheResult ? Array.from(cacheResult).reverse() : [];
	if (cachedFlags?.length > 0) {
		items.push({
			label: RECENT_FLAGS,
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
			label: FLAG_LIST,
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
		title: FLAG_FOR_RULE,
		placeHolder: SEARCH_FLAG,
		matchOnDescription: true,
		ignoreFocusOut: true,
	})) as FlagQuickPickItem;
	if (!flagWindow) {
		return;
	}

	return {
		flagWindow,
		flags,
	};
}
