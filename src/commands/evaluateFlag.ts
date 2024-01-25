import { commands, Disposable, QuickPickItemKind, window } from 'vscode';
import { ToggleCache } from '../toggleCache';
import os from 'os';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { LDMultiKindContext, LDSingleKindContext } from '@launchdarkly/node-server-sdk';
import { YamlContextReader } from '../utils/contextYAML';

// Not officially implemented. Leaving for future decision.

const cache = new ToggleCache();

type ContextSelection = {
	label: string;
	value: LDSingleKindContext | LDMultiKindContext;
};

type flagSelection = {
	label: string;
	description?: string;
	value: string;
};

export default function flagEvalCmd(config: LDExtensionConfiguration): Disposable {
	const flagEvalCmd = commands.registerCommand('launchdarkly.quickEval', async () => {
		let flags;
		try {
			flags = await config.getFlagStore()?.allFlagsMetadata();
		} catch (err) {
			window.showErrorMessage('[LaunchDarkly] Unable to retrieve flags, please check configuration.');
			return;
		}
		const items: Array<flagSelection | { label: string; kind: QuickPickItemKind }> = [];
		const cacheResult = cache.get();
		const cachedFlags = cacheResult ? Array.from(cacheResult).reverse() : [];

		//const cachedFlags = Array.from(cache.get()).reverse();
		if (cachedFlags?.length > 0) {
			items.push({
				label: 'Recently updated Feature Flags',
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
				value: flags[flag].key,
			}),
		);
		const flagWindow = (await window.showQuickPick(items, {
			title: 'Select Feature Flag to evaluate',
			placeHolder: 'Type flag key to toggle',
			matchOnDescription: true,
		})) as flagSelection;
		if (!flagWindow) {
			return;
		}
		await flagEval(config, flagWindow.value);
	});
	return flagEvalCmd;
}

function mapObjects(array, attribute) {
	return array.map((obj) => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { name, ...newObject } = obj;
		return obj[attribute] !== undefined
			? { label: obj[attribute], value: newObject }
			: { label: JSON.stringify(obj), value: newObject };
	});
}

export async function flagEval(config: LDExtensionConfiguration, key) {
	const filePath = os.homedir() + '/.launchdarkly/contexts.yaml';
	const contexts = YamlContextReader.read(filePath);
	if (contexts?.length === 0) {
		window.showErrorMessage('No contexts found in contexts.yaml');
		return;
	}
	const contextNames = mapObjects(contexts['contexts'], 'name');
	const selectedContext = await window.showQuickPick<ContextSelection>(contextNames, {
		placeHolder: `Select a context to evaluate for ${key}`,
	});
	if (!selectedContext) {
		return;
	}
	const flagValue = await config.getFlagStore()?.variationDetail(key, selectedContext.value);
	if (flagValue?.reason.ruleId) {
		const flag = await config.getFlagStore()?.getFeatureFlag(key, true);
		const flagEnv = flag.flag.environments[config.getConfig().env];
		if (flagEnv.rules) {
			for (const rule of flagEnv.rules) {
				if (rule._id === flagValue.reason.ruleId) {
					window.showInformationMessage(
						`Flag Details:\n${JSON.stringify(flagValue.value)}\n
						Reason:\n${JSON.stringify(flagValue.reason.kind)}\n
						Rule:\n${JSON.stringify(rule.description ? rule.description : rule._id)}
						[Open in Browser](${config.getSession()?.fullUri}/${config.getConfig()?.project}/${config.getConfig()
							?.env}/features/${key}/targeting#${rule._id})`,
						{ modal: true },
						{ title: 'Open in Browser', command: 'launchdarkly.openRule', arguments: [key, rule._id] },
					);
					// Rule was matched, return
					return;
				}
			}
		}
	}
	window.showInformationMessage(
		`Flag Details:\n${JSON.stringify(flagValue?.value)}\nReason:\n${JSON.stringify(flagValue?.reason)}`,
		{ modal: true },
	);
}
