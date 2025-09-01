import { QuickPickItemKind, window } from 'vscode';
import { ToggleCache } from '../toggleCache';
import { FlagQuickPickItem } from './selectRule';
import { ILDExtensionConfiguration } from '../models';
//import yaml from 'js-yaml';

const cache = new ToggleCache();

export default async function chooseFlagCmd(config: ILDExtensionConfiguration, flagKey?: string) {
	//const selectRuleCmd = commands.registerCommand('launchdarkly.chooseFlag', async () => {
	const flags = await config.getFlagStore()?.allFlagsMetadata();
	if (flags === undefined) {
		// Errors would be handled in the flagStore
		return;
	}
	let finalKey;
	if (flagKey) {
		finalKey = flagKey;
	} else {
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

		finalKey = flagWindow.value;
	}

	const flagData = flags[finalKey];
	flagData.clientSideAvailability;
	const updatedFlag = await config.getFlagStore().forceFeatureFlagUpdate(finalKey);
	const flagDataToKeep = ['key', 'name', 'description'];
	const newFlag = flagDataToKeep.reduce((obj, key) => {
		// eslint-disable-next-line no-prototype-builtins
		if (updatedFlag.hasOwnProperty(key)) {
			obj[key] = flagData[key];
		}
		return obj;
	}, {});

	const flagTargeting = await config.getFlagStore().getFlagConfig(finalKey);
	const deleteUnusedKeys = [
		'salt',
		'clientSide',
		'clientSideAvailability',
		'trackEvents',
		'trackEventsFallthrough',
		'version',
		'deleted',
		'key',
		'variations',
	];
	deleteUnusedKeys.forEach((key) => delete flagTargeting[key]);

	const sdkData = {
		flagMetadata: newFlag,
		lastModified: updatedFlag.environments[config.getConfig().env].lastModified,
		variations: updatedFlag['variations'],
		rulesMetadata: updatedFlag['environments'][config.getConfig().env]['rules'],
		clientSideAvailability: flagData.clientSideAvailability,
		targetData: flagTargeting,
	};

	return sdkData;
}
