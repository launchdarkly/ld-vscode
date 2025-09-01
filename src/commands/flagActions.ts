import { QuickPickItemKind, Disposable, commands, window, workspace, QuickPickItem } from 'vscode';
import { FlagQuickPickItem, targetFlag } from './selectRule';
import { ToggleCache } from '../toggleCache';
import { diffVariations, flagOffFallthroughPatch, toggleFlag, viewEditVariation } from '../generalUtils';
import { CMD_LD_FLAG_ACTION, CMD_LD_OPEN_BROWSER } from '../utils/commands';
import { flagCodeSearch } from '../utils/flagCodeSearch';
import { registerCommand } from '../utils/registerCommand';
import { ILDExtensionConfiguration } from '../models';
import { LDCONST_CMD_SUMMARIZE } from '../providers/copilot';

const cache = new ToggleCache();
const ACTION_TARGET = 'Quick Targeting';
const ACTION_TOGGLE = 'Toggle Enabled';
const ACTION_OPEN_BROWSER = 'Open in Browser';
const ACTION_SEARCH = 'Open Search';
const ACTION_REVEAL = 'Reveal in Sidebar';
const ACTION_UPDATE_FALLTHROUGH = 'Update fallthrough';
const ACTION_UPDATE_OFF = 'Update off';
const ACTION_VIEW_EDIT = 'View/Edit';
const ACTION_DIFF = 'Diff 2 Variations';
const ACTION_EXPLAIN_FLAG = '$(sparkles) Explain Flag';

export default function flagCmd(config: ILDExtensionConfiguration): Disposable {
	const flagCmd = registerCommand(CMD_LD_FLAG_ACTION, async () => {
		config.getApi().logEvent('VSCode Flag Actions', { command: 'flag action menu opened' });
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
		const setFlag = flags[flagWindow.value];

		const userCommands: QuickPickItem[] = [
			{ label: 'Overall Flag Actions', kind: QuickPickItemKind.Separator },
			{ label: ACTION_TARGET, detail: 'Quickly add individual targeting or rule to the selected flag.' },
			{ label: ACTION_TOGGLE, detail: 'Toggle selected flag on or off.' },
			{ label: ACTION_OPEN_BROWSER, detail: 'Open selected flag in browser.' },
			{ label: ACTION_SEARCH, detail: 'Search for selected flag key and aliases in the code.' },
			{ label: ACTION_REVEAL, detail: 'Opens Feature Flag list to selected flag.' },
		];

		// userCommands.push({
		// 	iconPath: new ThemeIcon('sparkles'),
		// 	label: ACTION_EXPLAIN_FLAG,
		// 	detail: 'Explain selected flag using Copilot.',
		// });

		// Group Variation related commands at the bottom of the list.
		userCommands.push(
			{ label: 'Variation Related Actions', kind: QuickPickItemKind.Separator },
			{ label: ACTION_UPDATE_FALLTHROUGH, detail: 'Change fallthrough variation for selected flag' },
			{ label: ACTION_UPDATE_OFF, detail: 'Change off variation for selected flag' },
		);

		const enableUpdateVariation = workspace.getConfiguration('launchdarkly').get('enableFlagActions.updateVariation');
		if (setFlag.kind !== 'boolean' && enableUpdateVariation) {
			userCommands.push({ label: ACTION_VIEW_EDIT, detail: 'View or Edit a variation on the flag.' });
			userCommands.push({ label: ACTION_DIFF, detail: 'View diff of 2 variations on the flag.' });
		}

		const selectedCommand = await window.showQuickPick(userCommands, {
			title: 'Select Command for flag',
			placeHolder: 'Type command to execute',
			matchOnDescription: true,
			ignoreFocusOut: true,
		});
		switch (selectedCommand?.label) {
			case ACTION_TARGET:
				await targetFlag(flagWindow, cache, config, flags);
				break;
			case ACTION_REVEAL:
				revealFlag(config, flagWindow.value);
				break;
			case ACTION_OPEN_BROWSER: {
				const linkUrl = `${config.getSession().fullUri}/${config.getConfig().project}/${
					config.getConfig().env
				}/features/${flagWindow.value}`;
				commands.executeCommand(CMD_LD_OPEN_BROWSER, linkUrl);
				break;
			}
			case ACTION_TOGGLE:
				await toggleFlag(config, flagWindow.value);
				break;
			case ACTION_SEARCH:
				flagCodeSearch(config, flagWindow.value);
				break;
			case ACTION_UPDATE_FALLTHROUGH:
				flagOffFallthroughPatch(config, 'updateFallthroughVariationOrRollout', flagWindow.value);
				break;
			case ACTION_UPDATE_OFF:
				flagOffFallthroughPatch(config, 'updateOffVariation', flagWindow.value);
				break;
			case ACTION_VIEW_EDIT:
				viewEditVariation(config, flagWindow.value);
				break;
			case ACTION_DIFF:
				diffVariations(config, flagWindow.value);
				break;
			case ACTION_EXPLAIN_FLAG: {
				const flag_cmd = {
					query: `@LaunchDarkly /${LDCONST_CMD_SUMMARIZE} #ld_flag:${flagWindow.value}`,
					isPartialQuery: false,
				};
				commands.executeCommand('workbench.action.chat.open', flag_cmd);
				break;
			}
			default:
				return;
		}
		config.getApi().logEvent('VSCode Flag Actions', { command: `${selectedCommand.label} completed` });
		return;
	});

	return flagCmd;
}

function revealFlag(config: ILDExtensionConfiguration, key: string) {
	const node = config.getFlagView().flagNodes.filter((node) => node.flagKey === key)[0];
	config.getFlagTreeProvider().reveal(node, { select: true, focus: true, expand: true });
}
