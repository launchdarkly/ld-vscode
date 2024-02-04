/**
 * Factory function to generate FlagNode
 */

import * as path from 'path';
import {
	Command,
	ExtensionContext,
	MarkdownString,
	TreeItem,
	TreeItemCollapsibleState,
	TreeItemLabel,
	Uri,
} from 'vscode';
import { FeatureFlag, FlagConfiguration } from '../models';
import { generateHoverString } from './hover';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

const COLLAPSED = TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = TreeItemCollapsibleState.None;

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
export function flagNodeFactory({
	ctx = null,
	label = '',
	collapsed = NON_COLLAPSED,
	children = [],
	ctxValue = '',
	uri = '',
	flagKey = '',
	flagParentName = '',
	flagVersion = 0,
}): FlagNode {
	return new FlagNode(ctx, label, collapsed, children, ctxValue, uri, flagKey, flagParentName, flagVersion);
}

/* eslint-enable @typescript-eslint/explicit-module-boundary-types */
/**
 * Class representing a Feature flag as vscode TreeItem
 * It is a nested array of FlagNode's to build the view
 */
export class FlagNode extends TreeItem {
	children: Array<unknown> | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
	command?: Command;
	/**
	 * @param label will be shown in the Treeview
	 * @param description is shown when hovering over node
	 * @param collapsibleState is initial state collapsible state
	 * @param children array of FlagNode's building nested view
	 * @param contextValue maps to svg resources to show icons
	 * @param uri URI to build link for Open Browser
	 * @param flagKey reference to which flag key the treeview item is associated with
	 * @param flagParentName will match the flag name for top level tree item
	 */
	constructor(
		ctx: ExtensionContext,
		public readonly label: string,
		public readonly collapsibleState: TreeItemCollapsibleState,
		children?: Array<unknown>,
		contextValue?: string,
		uri?: string,
		flagKey?: string,
		flagParentName?: string,
		flagVersion?: number,
		command?: Command,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.children = children;
		this.uri = uri;
		this.flagKey = flagKey;
		this.flagParentName = flagParentName;
		this.flagVersion = flagVersion;
		this.conditionalIcon(ctx, this.contextValue, this.label);
		this.command = command;
	}

	// Without this ignore the signature does not match the FlagTree interface
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	conditionalIcon(ctx: ExtensionContext, contextValue: string, label: string, enabled?: boolean): void {
		/**
		 * Special handling for open browser. Called in package.json
		 */
		if (contextValue == 'flagViewBrowser') {
			return;
		} else if (ctx && contextValue) {
			this.setIcon(ctx, contextValue);
		}
	}

	private setIcon(ctx: ExtensionContext, fileName: string): { light: string | Uri; dark: string | Uri } {
		return (this.iconPath = {
			light: ctx.asAbsolutePath(path.join('resources', 'light', fileName + '.svg')),
			dark: ctx.asAbsolutePath(path.join('resources', 'dark', fileName + '.svg')),
		});
	}
}

export async function flagToValues(
	flag: FeatureFlag,
	env: FlagConfiguration = null,
	ldConfig: LDExtensionConfiguration,
	flagParent?: FlagParentNode,
	label?: boolean,
): Promise<FlagParentNode> {
	/**
	 * Get Link for Open Browser and build base flag node.
	 */
	const config = ldConfig.getConfig();
	let envConfig;
	if (flag === undefined) {
		return;
	}
	if (env !== null) {
		envConfig = env;
	} else {
		try {
			const env = await this.flagStore.getFeatureFlag(flag.key);
			envConfig = env.config;
		} catch (err) {
			envConfig = new FlagConfiguration();
		}
	}
	let item;
	if (flagParent) {
		item = flagParent;
	} else if (flag) {
		item = new FlagParentNode(
			ldConfig.getCtx(),
			label ? { label: flag.name, highlights: [[0, flag.name.length]] } : flag.name ? flag.name : flag.key,
			generateHoverString(flag, envConfig, ldConfig),
			`${ldConfig.getSession().fullUri}/${config.project}/${config.env}/features/${flag.key}`,
			COLLAPSED,
			[],
			flag.key,
			flag._version,
			envConfig.on,
			[],
			'flagParentItem',
		);
	}

	/**
	 * User friendly name for building nested children under parent FlagNode
	 */
	const renderedFlagFields = item.children;

	/**
	 * Build list of tags under "Tags" label
	 */
	if (flag.tags.length > 0) {
		const tags: Array<FlagNode> = flag.tags.map((tag) => flagFactory({ label: tag }));
		renderedFlagFields.push(flagFactory({ label: `Tags`, children: tags, collapsed: COLLAPSED, ctxValue: 'tags' }));
	}
	if (ldConfig.getAliases()) {
		const aliasKeys = ldConfig.getAliases().getKeys();
		if (aliasKeys && aliasKeys[flag.key] !== undefined && aliasKeys[flag.key].length > 0) {
			const aliases: Array<FlagNode> = aliasKeys[flag.key].map((alias) => {
				const aliasNode = flagFactory({ label: alias, collapsed: NON_COLLAPSED, ctxValue: 'flagSearch' });
				aliasNode.command = {
					command: 'workbench.action.findInFiles',
					title: 'Find in Files',
					arguments: [{ query: alias, triggerSearch: true, matchWholeWord: true, isCaseSensitive: true }],
				};
				return aliasNode;
			});
			renderedFlagFields.push(
				flagFactory({
					label: `Aliases`,
					children: aliases,
					collapsed: COLLAPSED,
					ctxValue: 'aliases',
					flagKey: flag.key,
				}),
			);
		}
	}
	/**
	 * Build view for any Flag Prerequisites
	 */
	const prereqs: Array<FlagNode> = [];
	const flagPrereqs = envConfig.prerequisites;
	if (typeof flagPrereqs !== 'undefined' && flagPrereqs.length > 0) {
		flagPrereqs.map((prereq) => {
			prereqs.push(flagFactory({ label: `Flag: ${prereq.key}`, collapsed: NON_COLLAPSED }));
			prereqs.push(
				flagFactory({ label: `Variation: ${prereq.variation}`, collapsed: NON_COLLAPSED, ctx: ldConfig.getCtx() }),
			);
		});
		renderedFlagFields.push(
			flagFactory({
				label: `Prerequisites`,
				collapsed: prereqs.length > 0 ? COLLAPSED : NON_COLLAPSED,
				children: prereqs,
				ctxValue: 'prereq',
			}),
		);
	}

	/**
	 * Build individual targeting section for variation and targets assigned to each.
	 */
	const targets: Array<FlagNode> = [];
	const flagTargets = envConfig.targets;
	if (typeof flagTargets !== 'undefined' && flagTargets.length > 0) {
		flagTargets.map((target) => {
			targets.push(
				flagFactory({
					label: `Variation: ${
						flag.variations[target.variation].name
							? flag.variations[target.variation].name
							: flag.variations[target.variation].value
					}`,
					ctxValue: 'variation',
				}),
				flagFactory({ label: `Values: ${target.values}`, ctxValue: 'value' }),
			);
		});
		renderedFlagFields.push(
			flagFactory({
				label: `Targets`,
				collapsed: targets.length > 0 ? COLLAPSED : NON_COLLAPSED,
				children: targets,
				ctxValue: 'targets',
			}),
		);
	}

	/**
	 * Build Flag Variations
	 */
	const renderedVariations: Array<FlagNode> = [];
	flag.variations.forEach((variation) => {
		const variationValue = variation.name
			? [flagFactory({ label: `${JSON.stringify(variation.value)}`, ctxValue: 'value' })]
			: [];
		renderedVariations.push(
			flagFactory({
				label: `${variation.name ? variation.name : JSON.stringify(variation.value)}`,
				collapsed: variation.name ? COLLAPSED : NON_COLLAPSED,
				children: variationValue,
				ctxValue: 'variation',
			}),
		);

		if (variation.description) {
			renderedVariations.push(
				flagFactory({
					label: `Description: ${variation.description}`,
					ctxValue: 'description',
				}),
			);
		}
	});
	renderedFlagFields.push(
		flagFactory({
			label: `Variations`,
			collapsed: COLLAPSED,
			children: renderedVariations,
			ctxValue: 'variations',
		}),
	);

	/**
	 * Show number of rules on the Flag
	 */
	renderedFlagFields.push(
		flagFactory({
			label: `Rule count: ${envConfig.rules.length}`,
			ctxValue: 'flagRules',
		}),
	);

	/**
	 * Build Fallthrough view
	 */
	const defaultRule = envConfig.fallthrough;
	if (defaultRule.variation !== undefined) {
		const defaultRuleVar = flag.variations[defaultRule.variation];
		renderedFlagFields.push(
			flagFactory({
				label: `Default rule: ${defaultRuleVar.name ? defaultRuleVar.name : JSON.stringify(defaultRuleVar.value)}`,
				ctxValue: 'defaultRule',
				flagKey: envConfig.key,
			}),
		);
	} else if (defaultRule?.rollout !== undefined) {
		const fallThroughRollout: Array<FlagNode> = [];
		if (defaultRule.rollout.bucketBy) {
			new FlagNode(global.ldContext, `BucketBy: ${defaultRule.rollout.bucketBy}`, NON_COLLAPSED);
		}
		defaultRule.rollout.variations.map((variation) => {
			const weight = variation.weight / 1000;
			const flagVariation = flag.variations[variation.variation];
			fallThroughRollout.push(
				flagFactory({ label: `Weight: ${weight} % `, ctxValue: 'weight' }),
				flagFactory({
					label: `Variation: ${flagVariation.name || JSON.stringify(flagVariation.value)}`,
					ctxValue: 'variation',
				}),
			);
		});
		renderedFlagFields.push(
			flagFactory({
				label: `Default Rollout`,
				collapsed: COLLAPSED,
				children: fallThroughRollout,
				ctxValue: 'rollout',
				flagKey: flag.key,
			}),
		);
	}

	/**
	 * Build Off Variation view.
	 * TODO: Render even if undefined since that is valid option.
	 */
	if (envConfig.offVariation !== undefined) {
		const offVar = flag.variations[envConfig.offVariation];
		if (offVar !== undefined) {
			renderedFlagFields.push(
				flagFactory({
					label: `Off variation: ${offVar.name ? offVar.name : JSON.stringify(offVar.value)}`,
					ctxValue: 'variationOff',
					flagKey: flag.key,
				}),
			);
		}
	}

	/**
	 * Flag Defaults view for new Environments.
	 */
	if (flag.defaults !== undefined) {
		const defOnVar = flag.variations[flag.defaults.onVariation];
		const defOffVar = flag.variations[flag.defaults.offVariation];
		renderedFlagFields.push(
			flagFactory({
				label: `Defaults`,
				collapsed: COLLAPSED,
				children: [
					flagFactory({
						label: `On variation: ${defOnVar.name ? defOnVar.name : JSON.stringify(defOnVar.value)}`,
						ctxValue: 'variation',
					}),
					flagFactory({
						label: `Off variation: ${defOffVar.name ? defOffVar.name : JSON.stringify(defOffVar.value)}`,
						ctxValue: 'variation',
					}),
				],
			}),
		);
	}
	return item;
}

function flagFactory({
	label = '',
	collapsed = NON_COLLAPSED,
	children = [],
	ctxValue = '',
	uri = '',
	flagKey = '',
	flagParentName = '',
	flagVersion = 0,
	ctx = null,
}) {
	return flagNodeFactory({
		ctx: ctx,
		label: label,
		collapsed: collapsed,
		children: children,
		ctxValue: ctxValue,
		uri: uri,
		flagKey: flagKey,
		flagParentName: flagParentName,
		flagVersion: flagVersion,
	});
}

export class FlagParentNode extends TreeItem {
	children: FlagNode[] | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
	enabled?: boolean;
	aliases?: string[];

	/**
	 * @param label will be shown in the Treeview
	 * @param tooltip will be shown while hovering over node
	 * @param uri used when asked to open in browser
	 * @param collapsibleState is initial state collapsible state
	 * @param children array of FlagNode's building nested view
	 * @param flagKey reference to which flag key the treeview item is associated with
	 */
	constructor(
		ctx: ExtensionContext,
		public readonly label: string | TreeItemLabel,
		public readonly tooltip: string | MarkdownString,
		uri: string,
		public collapsibleState: TreeItemCollapsibleState,
		children?: FlagNode[],
		flagKey?: string,
		flagVersion?: number,
		enabled?: boolean,
		aliases?: string[],
		contextValue?: string,
	) {
		super(label, collapsibleState);
		this.children = children;
		this.description = flagKey;
		this.uri = uri;
		this.flagKey = flagKey;
		this.flagVersion = flagVersion;
		this.enabled = enabled;
		this.contextValue = contextValue;
		this.conditionalIcon(ctx, this.enabled);
		this.aliases = aliases;
	}

	private conditionalIcon(ctx: ExtensionContext, enabled: boolean) {
		this.setIcon(ctx, enabled ? 'toggleon' : 'toggleoff');
	}

	private setIcon(ctx: ExtensionContext, fileName: string): { light: string | Uri; dark: string | Uri } {
		return (this.iconPath = {
			light: ctx.asAbsolutePath(path.join('resources', 'light', fileName + '.svg')),
			dark: ctx.asAbsolutePath(path.join('resources', 'dark', fileName + '.svg')),
		});
	}
}
