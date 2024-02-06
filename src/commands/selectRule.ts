import { Disposable, ProgressLocation, QuickPickItem, QuickPickItemKind, window } from 'vscode';
import { YAMLIndividualTarget, YamlReader, YAMLRuleTarget } from '../utils/rulesYaml';
import { ToggleCache } from '../toggleCache';
import os from 'os';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { Dictionary, isArray } from 'lodash';
import crypto from 'crypto';
import { Clause, FeatureFlag, InstructionPatch } from '../models';
import { registerCommand } from '../utils';
import { logDebugMessage } from '../utils/logDebugMessage';

const cache = new ToggleCache();
const revertLastCmd = {};
const secondToLastCmd = {};
const AddTargets = 'addTargets';
const RemoveTargets = 'removeTargets';

type RuleSelection = {
	label: string;
	description?: string;
	value: YAMLIndividualTarget | YAMLRuleTarget;
	type?: 'rule' | 'target';
};

export interface FlagQuickPickItem extends QuickPickItem {
	value: string;
}

export default function selectRuleCmd(config: LDExtensionConfiguration): Disposable {
	const selectRuleCmd = registerCommand('launchdarkly.quickPickRules', async () => {
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
			title: 'Select Feature Flag for rule',
			placeHolder: 'Type flag key to toggle',
			matchOnDescription: true,
			ignoreFocusOut: true,
		})) as FlagQuickPickItem;
		if (!flagWindow) {
			return;
		}
		await targetFlag(flagWindow, cache, config, flags);
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

function createSingleTargetInstruction(kind, ctxKind, values, variationId) {
	return {
		kind,
		contextKind: ctxKind,
		values: values,
		variationId: variationId,
	};
}

function createAddRuleInstruction(ruleTarget: YAMLRuleTarget, environment: string, varIdx: string) {
	return {
		environmentKey: environment,
		instructions: [
			{
				kind: 'addRule',
				variationId: varIdx,
				ref: generateRefFromClauses(ruleTarget.clauses),
				clauses: ruleTarget.clauses.map((clause) => ({
					attribute: clause.attribute,
					op: clause.op,
					contextKind: clause.contextKind,
					values: clause.values,
					negate: clause.negate,
				})),
			},
		],
	};
}

function removeRuleInstruction(
	environment: string,
	{ ruleTarget, clauses }: { ruleTarget?: YAMLRuleTarget; clauses?: Array<Clause> },
) {
	return {
		environmentKey: environment,
		instructions: [
			{
				kind: 'removeRule',
				ref: generateRefFromClauses(clauses ? clauses : ruleTarget.clauses),
			},
		],
	};
}

async function updateFlag(
	flagWindow: FlagQuickPickItem,
	cache: ToggleCache,
	config: LDExtensionConfiguration,
	instruction: InstructionPatch,
	origFlag?: FeatureFlag,
): Promise<FeatureFlag | undefined> {
	if (typeof flagWindow === 'undefined') {
		return;
	}

	let flag: FeatureFlag | undefined;
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

			progress.report({ increment: 10, message: `Updating flag` });

			try {
				flag = await config
					.getFlagStore()
					.executeAndUpdateFlagStore(
						config.getApi().patchFeatureFlagSem.bind(config.getApi()),
						config.getConfig().project,
						flagWindow.value,
						instruction,
					);
				cache.set(flagWindow.value);
				const previousCommand = secondToLastCmd[flagWindow.value];
				if (Object.keys(revertLastCmd)?.length > 0) {
					Object.assign(secondToLastCmd, revertLastCmd);
				}
				switch (instruction.instructions[0].kind) {
					case AddTargets:
						revertLastCmd[flagWindow.value] = {
							...instruction,
							instructions: [{ ...instruction.instructions[0], kind: RemoveTargets }],
						};
						break;
					case RemoveTargets:
						revertLastCmd[flagWindow.value] = {
							...instruction,
							instructions: [{ ...instruction.instructions[0], kind: AddTargets }],
						};
						break;
					case 'addRule':
						revertLastCmd[flagWindow.value] = removeRuleInstruction(config.getConfig().env, {
							clauses: instruction.instructions[0].clauses,
						});
						secondToLastCmd[flagWindow.value] = instruction;
						break;
					case 'removeRule':
						if (previousCommand) {
							revertLastCmd[flagWindow.value] = previousCommand;
						}
						break;
				}
			} catch (err) {
				console.log(err);
				const status = err.response?.status;
				const message = err.response?.data.message;
				switch (status) {
					case 403:
						window.showErrorMessage(
							`Unauthorized: Your key does not have permissions to update the flag: ${flagWindow.value}`,
						);
						break;
					case 400:
						if (message.includes('ref') && message.includes('already exists')) {
							const removeExisting = removeRuleInstruction(config.getConfig().env, {
								clauses: instruction.instructions[0].clauses,
							});
							try {
								// The ref already exists but we don't know which variation. So we remove and then re-add the rule.
								// TODO: optimize
								await config.getApi().patchFeatureFlagSem(config.getConfig().project, flagWindow.value, removeExisting);
								await config
									.getFlagStore()
									.executeAndUpdateFlagStore(
										config.getApi().patchFeatureFlagSem.bind(config.getApi()),
										config.getConfig().project,
										flagWindow.value,
										instruction,
									);
							} catch (err) {
								window.showInformationMessage(
									`Error removing and adding new rule for: ${flagWindow.value}\n Error: ${message}`,
								);
							}
							progress.report({ increment: 100 });
						} else if (status === 400 && instruction.instructions[0].kind === AddTargets) {
							// This is a hack to get around the fact that the API does not support in place updates to targets
							const sdkFlag = await config.getFlagStore().getFlagConfig(flagWindow.value);

							const instructions = [];
							for (const target in sdkFlag['targets']) {
								if (sdkFlag['targets'][target].values?.includes(instruction.instructions[0].values[0])) {
									instructions.push(
										createSingleTargetInstruction(
											RemoveTargets,
											sdkFlag['targets'][target].contextKind,
											[instruction.instructions[0].values[0]],
											origFlag.variations[sdkFlag['targets'][target].variation]._id,
										),
									);
									// No need to loop over the rest of targets
									break;
								}
								instructions.push(instruction.instructions[0]);

								const newPatch = {
									environmentKey: config.getConfig().env,
									instructions,
								};
								const newFlag = await config
									.getApi()
									.patchFeatureFlagSem(config.getConfig().project, flagWindow.value, newPatch);
								if (newFlag instanceof Error) {
									window.showErrorMessage(`Could not update flag: ${flagWindow.value}\n\n${newFlag.message}`);
								}
							}
						} else {
							window.showErrorMessage(
								`Could not update flag: ${flagWindow.value}\nIs this context targeting? Is it used by another variation?\n\n Status: ${err?.response?.status}\n\nMessage: ${err.message}`,
							);
						}
						break;
					default:
						window.showErrorMessage(`Could not update flag: ${flagWindow.value}
					code: ${err?.response?.status}
					message: ${err.message}`);
				}
				//if (err?.response?.status === 403) {

				// } else if (
				// 	err?.response?.status === 400 &&
				// 	err.response.data.message.includes('ref') &&
				// 	err.response.data.message.includes('already exists')
				// )
				// } else if (err?.response?.status === 400 && instruction.instructions[0].kind === AddTargets) {
				// 	// This is a hack to get around the fact that the API does not support in place updates to targets
				// 	const sdkFlag = await config.getFlagStore().getFlagConfig(flagWindow.value);

				// 	const instructions = [];
				// 	for (const target in sdkFlag['targets']) {
				// 		if (sdkFlag['targets'][target].values?.includes(instruction.instructions[0].values[0])) {
				// 			instructions.push(
				// 				createSingleTargetInstruction(
				// 					RemoveTargets,
				// 					sdkFlag['targets'][target].contextKind,
				// 					[instruction.instructions[0].values[0]],
				// 					origFlag.variations[sdkFlag['targets'][target].variation]._id,
				// 				),
				// 			);
				// 			// No need to loop over the rest of targets
				// 			break;
				// 		}
				// 		instructions.push(instruction.instructions[0]);

				// 		const newPatch = {
				// 			environmentKey: config.getConfig().env,
				// 			instructions,
				// 		};
				// 		const newFlag = await config
				// 			.getApi()
				// 			.patchFeatureFlagSem(config.getConfig().project, flagWindow.value, newPatch);
				// 		if (newFlag instanceof Error) {
				// 			window.showErrorMessage(`Could not update flag: ${flagWindow.value}\n\n${newFlag.message}`);
				// 		}
			}
			// 	} else if (err?.response?.status === 400) {
			// 		window.showErrorMessage(
			// 			`Could not update flag: ${flagWindow.value}\nIs this context targeting? Is it used by another variation?\n\n Status: ${err?.response?.status}\n\nMessage: ${err.message}`,
			// 		);
			// 	} else {
			// 		window.showErrorMessage(`Could not update flag: ${flagWindow.value}
			// 		code: ${err?.response?.status}
			// 		message: ${err.message}`);
			// 	}
			// }

			progress.report({ increment: 90, message: 'Flag Updated' });
		},
	);
	return flag;
}

function handleTargetUpdate(targetingCase: string, env: string, selectedRule: RuleSelection, varIdx: string) {
	const rule = selectedRule.value as YAMLIndividualTarget;
	const ctxKind = rule.contextKind ? rule.contextKind : 'user';
	switch (targetingCase) {
		case 'add': {
			return createTargetInstruction(
				env,
				AddTargets,
				ctxKind,
				isArray(rule.values) ? rule.values : [rule.values],
				varIdx,
			);
		}
		case 'remove': {
			return createTargetInstruction(
				env,
				RemoveTargets,
				ctxKind,
				isArray(rule.values) ? rule.values : [rule.values],
				varIdx,
			);
		}
		case 'revert': {
			break;
		}
	}
}

function handleRuleUpdate(targetingCase: string, env: string, selectedRule: YAMLRuleTarget, varIdx: string) {
	switch (targetingCase) {
		case 'add': {
			return createAddRuleInstruction(selectedRule, env, varIdx);
		}
		case 'remove': {
			return removeRuleInstruction(env, { ruleTarget: selectedRule });
		}
		case 'revert': {
			break;
		}
	}
}

function generateRefFromClauses(clauses) {
	const joinedClauses = clauses.map((clause) => {
		`${clause.attribute}${clause.op}${clause.values.join('')}${clause.contextKind || ''}${clause.negate}`;
	});

	const hash = crypto.createHash('sha256');
	hash.update(joinedClauses.join(''));
	const hashedClause = hash.digest('hex').substring(0, 20);
	return `vscode${hashedClause}`;
}

export async function targetFlag(
	flagWindow,
	cache: ToggleCache,
	config: LDExtensionConfiguration,
	flags: Dictionary<FeatureFlag>,
) {
	const addRemove: Array<FlagQuickPickItem> = [];
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
		matchOnDetail: true,
		ignoreFocusOut: true,
	});
	if (!addRemoveTargeting) {
		return;
	}

	if (addRemoveTargeting.value === 'revert') {
		let instruction;
		if (revertLastCmd[flagWindow.value].instructions[0].kind === 'removeRule') {
			instruction = revertLastCmd[flagWindow.value];
		} else {
			instruction = createTargetInstruction(
				config.getConfig().env,
				revertLastCmd[flagWindow.value].instructions[0].kind,
				revertLastCmd[flagWindow.value].instructions[0].contextKind,
				revertLastCmd[flagWindow.value].instructions[0].values,
				revertLastCmd[flagWindow.value].instructions[0].variationId,
			);
		}
		await updateFlag(flagWindow, cache, config, instruction, flags[flagWindow.value]);
		return;
	}

	const filePath = os.homedir() + '/.launchdarkly/rules.yaml';
	const rules = YamlReader.read(filePath);
	if (rules === undefined || rules?.length === 0) {
		window.showInformationMessage('No rules found in rules.yaml');
		return;
	}
	const ruleNames = rules['rules'] ? mapObjects(rules['rules'], 'name', 'rule') : [];
	const targetNames = rules['targets'] ? mapObjects(rules['targets'], 'name', 'target') : [];
	const targetDivider = {
		label: 'Individual Targeting',
		kind: QuickPickItemKind.Separator,
	};
	const rulesDivider = {
		label: 'Rule Targeting',
		kind: QuickPickItemKind.Separator,
	};
	const ruleList = [targetDivider, ...targetNames, rulesDivider, ...ruleNames];
	const selectedRule = await window.showQuickPick<RuleSelection>(ruleList, {
		placeHolder: `Select a target for ${flagWindow.value}`,
		ignoreFocusOut: true,
	});

	const flagVariations = flags[flagWindow.value].variations.map((variation, idx) => {
		return `${idx}. ${variation.name ? variation.name : variation.value}`;
	});

	const selectedVariation = await window.showQuickPick(flagVariations, {
		placeHolder: `Select which flag variation to update targets`,
		ignoreFocusOut: true,
	});
	let instruction;
	if (selectedVariation && selectedRule) {
		const varIdx = selectedVariation.split('.')[0];
		const variationID = flags[flagWindow.value].variations[varIdx]._id;
		if (selectedRule.value.type === 'target') {
			instruction = handleTargetUpdate(addRemoveTargeting.value, config.getConfig()!.env, selectedRule, variationID);
		} else {
			instruction = handleRuleUpdate(
				addRemoveTargeting.value,
				config.getConfig()!.env,
				selectedRule.value as YAMLRuleTarget,
				variationID,
			);
		}
		logDebugMessage(`Instruction for ${flagWindow.value}: ${JSON.stringify(instruction)}`);
	}
	await updateFlag(flagWindow, cache, config, instruction, flags[flagWindow.value]);
	const flagStatus = await config.getFlagStore().getFlagConfig(flagWindow.value);
	if (!flagStatus.on) {
		window
			.showInformationMessage(
				`Flag: ${flagWindow.value} is not on in environment: ${config.getConfig().env}.
			Only the Off Variation will be served.
			Would you like to turn the flag on?`,
				{ modal: true },
				{ title: 'Turn flag on', command: 'launchdarkly.openRule' },
			)
			.then(async (selection) => {
				if (selection?.title === 'Turn flag on') {
					const onInstruction = {
						environmentKey: config.getConfig().env,
						instructions: [{ kind: 'turnFlagOn' }],
					};
					await updateFlag(flagWindow, cache, config, onInstruction);
				}
			});
	}
}
