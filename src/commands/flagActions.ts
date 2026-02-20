import { QuickPickItemKind, Disposable, commands, window } from 'vscode';
import { FlagQuickPickItem, targetFlag } from './selectRule';
import { ToggleCache } from '../toggleCache';
import { flagOffFallthroughPatch, toggleFlag } from '../generalUtils';
import { CMD_LD_FLAG_ACTION, CMD_LD_OPEN_BROWSER } from '../utils/commands';
import { flagCodeSearch } from '../utils/flagCodeSearch';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';

const cache = new ToggleCache();

export default function flagCmd(config: ILDExtensionConfiguration): Disposable {
	const flagCmd = registerCommand(CMD_LD_FLAG_ACTION, async () => {
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
			title: 'Select Feature Flag for action',
			placeHolder: 'Type flag name or key to search',
			matchOnDescription: true,
			matchOnDetail: true,
			ignoreFocusOut: true,
		})) as FlagQuickPickItem;
		if (!flagWindow) {
			return;
		}
		cache.set(flagWindow.value);
		const userCommands = [
			{ label: 'Quick Targeting', detail: 'Quickly add individual targeting or rule to the selected flag.' },
			{ label: 'Toggle Flag', detail: 'Toggle selected flag on or off.' },
			{ label: 'Open Flag in Browser', detail: 'Open selected flag in browser.' },
			{ label: 'Search Flag', detail: 'Search for selected flag key and aliases in the code.' },
			{ label: 'Reveal in Sidebar', detail: 'Opens Feature Flag list to selected flag.' },
			{ label: 'Update fallthrough variation', detail: 'Change fallthrough variation for selected flag' },
			{ label: 'Update off variation', detail: 'Change off variation for selected flag' },
		];
		const selectedCommand = await window.showQuickPick(userCommands, {
			title: 'Select Command for flag',
			placeHolder: 'Type command to execute',
			matchOnDescription: true,
			ignoreFocusOut: true,
		});
		switch (selectedCommand?.label) {
			case 'Quick Targeting':
				await targetFlag(flagWindow, cache, config, flags);
				break;
			case 'Reveal in Sidebar':
				revealFlag(config, flagWindow.value);
				break;
			case 'Open Flag in Browser': {
				const linkUrl = `${config.getSession().fullUri}/${config.getConfig().project}/${
					config.getConfig().env
				}/features/${flagWindow.value}`;
				commands.executeCommand(CMD_LD_OPEN_BROWSER, linkUrl);
				break;
			}
			case 'Toggle Flag':
				await toggleFlag(config, flagWindow.value);
				break;
			case 'Search Flag':
				flagCodeSearch(config, flagWindow.value);
				break;
			case 'Update fallthrough variation':
				flagOffFallthroughPatch(config, 'updateFallthroughVariationOrRollout', flagWindow.value);
				break;
			case 'Update off variation':
				flagOffFallthroughPatch(config, 'updateOffVariation', flagWindow.value);
				break;
		}

		return;
	});

	return flagCmd;
}

function revealFlag(config: ILDExtensionConfiguration, key: string) {
	const node = config.getFlagView().flagNodes.filter((node) => node.flagKey === key)[0];
	config.getFlagTreeProvider().reveal(node, { select: true, focus: true, expand: true });
}
