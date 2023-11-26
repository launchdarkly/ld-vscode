import { commands, Disposable, ProgressLocation, QuickPickItemKind, window } from 'vscode';
import { YamlReader } from '../utils/rulesYaml';
import { ToggleCache } from '../toggleCache';
import os from 'os';
import { Clause, Rule } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

const cache = new ToggleCache();
const revertLastCmd = {};

type yamlIndividualTarget = {
	name: string;
	contextKind: string;
	values: string | string[];
};

export default function selectRuleCmd(config: LDExtensionConfiguration): Disposable {
	const selectRuleCmd = commands.registerCommand('launchdarkly.quickPickRules', async () => {
		let flags;
		try {
			flags = await config.getFlagStore().allFlagsMetadata();
		} catch (err) {
			window.showErrorMessage('[LaunchDarkly] Unable to retrieve flags, please check configuration.');
			return;
		}
		const items = [];
		const cachedFlags = Array.from(cache.get()).reverse();
		if (cachedFlags.length > 0) {
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
		const flagWindow = await window.showQuickPick(items, {
			title: 'Select Feature Flag for rule',
			placeHolder: 'Type flag key to toggle',
			matchOnDescription: true,
		});

		const addRemove = [];
		if (typeof revertLastCmd[flagWindow.value] !== 'undefined') {
			addRemove.push({
				label: 'Revert Last Targeting Change',
				description: 'Revert Last Targeting Change',
				value: 'revert',
			});
		}

		addRemove.push(
			{
				label: 'Add',
				description: 'Add targeting to flag',
				value: 'add',
			},
			{
				label: 'Remove',
				description: 'Remove targeting from flag',
				value: 'remove',
			},
		);

		const addRemoveTargeting = await window.showQuickPick(addRemove, {
			title: 'Select Feature Flag for rule',
			placeHolder: 'Type flag key to toggle',
			matchOnDescription: true,
		});
		if (addRemoveTargeting.value === 'revert') {
			const instruction = createTargetInstruction(
				config.getConfig().env,
				revertLastCmd[flagWindow.value].instructions[0].kind,
				revertLastCmd[flagWindow.value].instructions[0].contextKind,
				revertLastCmd[flagWindow.value].instructions[0].values,
				revertLastCmd[flagWindow.value].instructions[0].variationId,
			);
			await updateFlag(flagWindow, cache, config.getApi(), config.getConfig(), instruction);
			return;
		}

		const filePath = os.homedir() + '/.launchdarkly/rules.yaml';
		const rules = YamlReader.read(filePath);

		//const ruleNames = mapObjects(rules['rules'], 'name', 'rule');
		const targetNames = mapObjects(rules['targets'], 'name', 'target');
		const targetDivider = {
			label: 'Individual Targeting',
			kind: QuickPickItemKind.Separator,
		};
		// const rulesDivider = {
		// 	label: 'Rule Targeting',
		// 	kind: QuickPickItemKind.Separator,
		// };
		const ruleList = [targetDivider, ...targetNames];
		const selectedRule = await window.showQuickPick<{ label: string; value: yamlIndividualTarget | any }>(ruleList, {
			placeHolder: `Select a target for ${flagWindow.value}`,
		});

		const flagVariations = flags[flagWindow.value].variations.map((variation, idx) => {
			return `${idx}. ${variation.name ? variation.name : variation.value}`;
		});

		const selectedVariation = await window.showQuickPick(flagVariations, {
			placeHolder: `Select which flag variation to update targets`,
		});
		let instruction;
		if (selectedVariation) {
			const varIdx = selectedVariation.split('.')[0];
			const ctxKind = selectedRule.value.contextKind ? selectedRule.value.contextKind : 'user';
	
			switch (addRemoveTargeting.value) {
				case 'add': {
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					//@ts-ignore
					instruction = createTargetInstruction(
						config.getConfig().env,
						'addTargets',
						ctxKind,
						[selectedRule.value.values],
						flags[flagWindow.value].variations[varIdx]._id,
					);
					break;
				}
				case 'remove': {
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					//@ts-ignore
					instruction = createTargetInstruction(
						config.getConfig().env,
						'removeTargets',
						ctxKind,
						[selectedRule.value.values],
						flags[flagWindow.value].variations[varIdx]._id,
					);
					break;
				}
				case 'revert': {
					break;
				}
			}
		}
		await updateFlag(flagWindow, cache, config.getApi(), config.getConfig(), instruction);
		config.getCtx().subscriptions.push(selectRuleCmd);
	});
	return selectRuleCmd;
}

function mapObjects(array, attribute, type) {
	return array.map((obj) => {
		obj['type'] = type;
		return obj[attribute] !== undefined
			? { label: obj[attribute], value: obj }
			: { label: JSON.stringify(obj), value: obj };
	});
}

function createTargetInstruction(environmentKey, kind, ctxKind, values, variationId) {
	return {
		environmentKey: environmentKey,
		instructions: [
			{
				kind,
				contextKind: ctxKind,
				values: values,
				variationId: variationId,
			},
		],
	};
}

function createAddRuleInstruction(
	environmentKey: string,
	kind: string,
	variationId: string,
	description: string,
	clauses: Clause[],
) {
	//const clausesWithKey = clauses.map((clause) => { return { ...clause, "_key": uuidv4() } })
	return {
		//comment: "",
		environmentKey: environmentKey,
		instructions: [
			{
				//description: description,
				kind,
				variationId,
				clauses: clauses,
				//ruleId: uuidv4()
			},
		],
	};
}

async function updateFlag(flagWindow, cache, api, config, instruction) {
	if (typeof flagWindow !== 'undefined') {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `LaunchDarkly: Updating Flag ${flagWindow.value}`,
				cancellable: true,
			},
			async (progress, token) => {
				token.onCancellationRequested(() => {
					console.log('User canceled the long running operation');
				});

				progress.report({ increment: 0 });
				progress.report({ increment: 10, message: `Updating flag` });

				try {
					await api.patchFeatureFlagSem(config.project, flagWindow.value, instruction);
					cache.set(flagWindow.value);
					if (instruction.instructions[0].kind === 'addTargets') {
						revertLastCmd[flagWindow.value] = instruction;
						revertLastCmd[flagWindow.value].instructions[0].kind = 'removeTargets';
					} else {
						revertLastCmd[flagWindow.value] = instruction;
						revertLastCmd[flagWindow.value].instructions[0].kind = 'addTargets';
					}
				} catch (err) {
					console.log(err);
					progress.report({ increment: 100 });
					if (err.response.status === 403) {
						window.showErrorMessage(
							`Unauthorized: Your key does not have permissions to update the flag: ${flagWindow.value}`,
						);
					} else {
						window.showErrorMessage(`Could not update flag: ${flagWindow.value}
					code: ${err.response.status}
					message: ${err.message}`);
					}
				}

				progress.report({ increment: 90, message: 'Flag Updated' });
			},
		);
	}
}
