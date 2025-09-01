import { Disposable, commands, window, QuickPickItemKind } from 'vscode';
import { FlagQuickPickItem } from './selectRule';
import { ToggleCache } from '../toggleCache'; // Assuming ToggleCache is exported from this module
import { ILDExtensionConfiguration } from '../models';

const cache = new ToggleCache();

export default function debugFlagCmd(config: ILDExtensionConfiguration): Disposable {
	const debugFlagCmd = commands.registerCommand('launchdarkly.debugFlag', async () => {
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
				label: 'Recently selected Feature Flags',
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
		config.getDebugHandler().setFlagKey(flagWindow.value);
		config.getDebugHandler().subscribe();

		setTimeout(() => {
			config.getDebugHandler().unsubscribe();
		}, 10000);
		//await targetFlag(flagWindow, cache, config, flags);
		//});
		return debugFlagCmd;
	});
	return debugFlagCmd;
}
