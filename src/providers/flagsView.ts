import * as vscode from 'vscode';
import { FeatureFlag, FlagConfiguration, PatchComment, PatchOperation } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';
import { debounce, map } from 'lodash';
import { FlagAliases } from './codeRefs';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagTreeInterface> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagNodes: Array<FlagTreeInterface>;
	private aliases: FlagAliases;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagTreeInterface | null | void> = new vscode.EventEmitter<FlagTreeInterface | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagTreeInterface | null | void> = this._onDidChangeTreeData.event;

	constructor(
		api: LaunchDarklyAPI,
		config: Configuration,
		flagStore: FlagStore,
		ctx: vscode.ExtensionContext,
		aliases?: FlagAliases,
	) {
		this.api = api;
		this.config = config;
		this.ctx = ctx;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.registerCommands();
		this.start();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	async reload(e?: vscode.ConfigurationChangeEvent | undefined): Promise<void> {
		if (e && this.config.streamingConfigReloadCheck(e)) {
			return;
		}
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				await this.getFlags();
				await this.flagUpdateListener();
				this.refresh();
			} catch (err) {
				console.error(err);
			}
		},
		200,
		{ leading: false, trailing: true },
	);

	getTreeItem(element: FlagTreeInterface): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlagTreeInterface): Promise<FlagTreeInterface[]> {
		if (typeof this.flagNodes === 'undefined' || this.flagNodes.length == 0) {
			return Promise.resolve([new FlagNode(this.ctx, 'No Flags Found.', NON_COLLAPSED)]);
		}

		return Promise.resolve(element ? element.children : this.flagNodes);
	}

	setFlagsStore(flagstore: FlagStore): void {
		this.flagStore = flagstore;
		this.flagUpdateListener();
	}

	async getFlags(): Promise<void> {
		try {
			const nodes = [];
			const flags = await this.flagStore.allFlagsMetadata();
			map(flags, value => {
				this.flagToValues(value).then(node => {
					nodes.push(node);
				});
			});
			this.flagNodes = nodes;
		} catch (err) {
			console.error(err);
			const message = 'Error retrieving Flags: `${err}';
			this.flagNodes = [new FlagParentNode(this.ctx, message, NON_COLLAPSED)];
		}
		if (!this.flagNodes) {
			this.flagNodes = [new FlagParentNode(this.ctx, 'No Flags Found.', NON_COLLAPSED)];
		}
	}

	registerTreeviewRefreshCommand(): vscode.Disposable {
		return vscode.commands.registerCommand('launchdarkly.treeviewrefresh', (): void => {
			this.reload();
			vscode.commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', this.config.enableFlagExplorer);
		});
	}

	async registerCommands(): Promise<void> {
		this.ctx.subscriptions.push(
			vscode.commands.registerCommand('launchdarkly.copyKey', (node: FlagNode) =>
				vscode.env.clipboard.writeText(node.label.split(':')[1].trim()),
			),
			vscode.commands.registerCommand('launchdarkly.openBrowser', (node: FlagNode) =>
				vscode.env.openExternal(vscode.Uri.parse(node.uri)),
			),
			vscode.commands.registerCommand('launchdarkly.refreshEntry', () => this.reload()),
			this.registerTreeviewRefreshCommand(),
			vscode.commands.registerCommand('launchdarkly.flagMultipleSearch', (node: FlagNode) => {
				const aliases = this.aliases.getKeys()
				console.log(aliases[node.flagKey].join("|"))
				vscode.commands.executeCommand('workbench.action.findInFiles', {
					query: aliases[node.flagKey].join("|"),
					triggerSearch: true,
					matchWholeWord: true,
					isCaseSensitive: true,
				});
			}),
			vscode.commands.registerCommand('launchdarkly.toggleFlag', async (node: FlagParentNode) => {
				const env = await this.flagStore.getFeatureFlag(node.flagKey);
				this.api.patchFeatureFlagOn(this.config.project, node.flagKey, !env.config.on);
			}),
			vscode.commands.registerCommand('launchdarkly.fallthroughChange', async (node: FlagNode) => {
				this.flagPatch(node, `/environments/${this.config.env}/fallthrough/variation`, node.contextValue);
			}),
			vscode.commands.registerCommand('launchdarkly.offChange', async (node: FlagNode) => {
				this.flagPatch(node, `/environments/${this.config.env}/offVariation`);
			}),
		);
	}

	async start(): Promise<void> {
		if (!this.config.streamingConfigStartCheck()) {
			return;
		}
		await this.reload();
	}

	private async flagPatch(node: FlagTreeInterface, path: string, contextValue?: string): Promise<void> {
		const env = await this.flagStore.getFeatureFlag(node.flagKey);
		const variations = env.flag.variations.map((variation, idx) => {
			return `${idx}. ${variation.name ? variation.name : variation.value}`;
		});
		const choice = await vscode.window.showQuickPick(variations);
		const newValue = choice.split('.')[0];
		const patch = [];
		patch.push({ op: 'replace', path: path, value: parseInt(newValue) });
		if (contextValue && contextValue === 'rollout') {
			patch.push({ op: 'remove', path: `/environments/${this.config.env}/fallthrough/rollout` });
		}
		const patchComment = new PatchComment();
		patchComment.comment = 'Update by VSCode';
		patchComment.patch = patch;
		try {
			this.api.patchFeatureFlag(this.config.project, node.flagKey, patchComment);
		} catch (err) {
			if (err.statusCode === 401) {
				vscode.window.showErrorMessage('Unauthorized: Your key does not have permissions to change the flag.', err);
			} else {
				vscode.window.showErrorMessage(err.body);
			}
		}
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.flagStore.on('update', async (keys: string) => {
			try {
				const flagKeys = Object.values(keys);
				flagKeys.map(key => {
					this.flagStore.getFeatureFlag(key).then(updatedFlag => {
						const updatedIdx = this.flagNodes.findIndex(v => v.flagKey === key);
						this.flagToValues(updatedFlag.flag, updatedFlag.config).then(newFlagValue => {
							this.flagNodes[updatedIdx] = newFlagValue;
						});
					});
				});
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
		});
		this.flagStore.storeUpdates.event(async () => {
			const flags = await this.flagStore.allFlagsMetadata();
			if (flags.length !== this.flagNodes.length) {
				const nodes = [];
				map(flags, value => {
					this.flagToValues(value).then(node => {
						nodes.push(node);
					});
				});
				this.flagNodes = nodes;
			} else {
				map(flags, async flag => {
					const updatedIdx = this.flagNodes.findIndex(v => v.flagKey === flag.key);
					if (this.flagNodes[updatedIdx].flagVersion < flag._version) {
						this.flagNodes[updatedIdx] = await this.flagToValues(flag);
					}
				});
			}
			this.refresh();
		});
		if (this.aliases) {
			this.aliases.aliasUpdates.event(async () => {
				this.reload();
			});
		}
	}

	private flagFactory({
		label = '',
		collapsed = NON_COLLAPSED,
		children = [],
		ctxValue = '',
		uri = '',
		flagKey = '',
		flagParentName = '',
		flagVersion = 0,
	}) {
		return flagNodeFactory({
			ctx: this.ctx,
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

	private async flagToValues(flag: FeatureFlag, env: FlagConfiguration = null): Promise<FlagParentNode> {
		/**
		 * Get Link for Open Browser and build base flag node.
		 */
		let envConfig;
		if (env !== null) {
			envConfig = env;
		} else {
			const env = await this.flagStore.getFeatureFlag(flag.key);
			envConfig = env.config;
		}

		const flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href;
		const item = new FlagParentNode(
			this.ctx,
			flag.name,
			COLLAPSED,
			[
				this.flagFactory({ label: `Open in Browser`, ctxValue: 'flagViewBrowser', uri: flagUri }),
				this.flagFactory({ label: `Key: ${flag.key}`, ctxValue: 'flagViewKey' }),
			],
			flag.key,
			flag._version,
			envConfig.on,
			[],
			"flagParentItem"
		);
		/**
		 * User friendly name for building nested children under parent FlagNode
		 */
		const renderedFlagFields = item.children;

		/**
		 * Check flag description
		 */
		if (flag.description) {
			renderedFlagFields.push(
				this.flagFactory({
					label: `Description: ${flag.description ? flag.description : ''}`,
					ctxValue: 'description',
				}),
			);
		}

		/**
		 * Build list of tags under "Tags" label
		 */
		if (flag.tags.length > 0) {
			const tags: Array<FlagNode> = flag.tags.map(tag => this.flagFactory({ label: tag, ctxValue: 'flagTagItem' }));
			renderedFlagFields.push(
				this.flagFactory({ label: `Tags`, children: tags, collapsed: COLLAPSED, ctxValue: 'tags' }),
			);
		}
		const aliasKeys = this.aliases.getKeys()
		if (this.aliases && aliasKeys[flag.key]) {
			const aliases: Array<FlagNode> = aliasKeys[flag.key].map(alias => {
				const aliasNode = this.flagFactory({ label: alias, collapsed: NON_COLLAPSED, ctxValue: 'flagSearch' })
				aliasNode.command = {
					command: 'workbench.action.findInFiles',
					title: 'Find in Files',
					arguments: [{ query: alias, triggerSearch: true, matchWholeWord: true, isCaseSensitive: true}],
				};
				return aliasNode;
			});
			renderedFlagFields.push(
				this.flagFactory({ label: `Aliases`, children: aliases, collapsed: COLLAPSED, ctxValue: 'aliases', flagKey: flag.key }),
			);
		}
		/**
		 * Build view for any Flag Prerequisites
		 */
		const prereqs: Array<FlagNode> = [];
		const flagPrereqs = envConfig.prerequisites;
		if (typeof flagPrereqs !== 'undefined' && flagPrereqs.length > 0) {
			flagPrereqs.map(prereq => {
				prereqs.push(this.flagFactory({ label: `Flag: ${prereq.key}`, collapsed: NON_COLLAPSED }));
				prereqs.push(this.flagFactory({ label: `Variation: ${prereq.variation}`, collapsed: NON_COLLAPSED }));
			});
			renderedFlagFields.push(
				this.flagFactory({
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
			flagTargets.map(target => {
				targets.push(
					this.flagFactory({
						label: `Variation: ${
							flag.variations[target.variation].name
								? flag.variations[target.variation].name
								: flag.variations[target.variation].value
						}`,
						ctxValue: 'variation',
					}),
					this.flagFactory({ label: `Values: ${target.values}`, ctxValue: 'value' }),
				);
			});
			renderedFlagFields.push(
				this.flagFactory({
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
		flag.variations.forEach(variation => {
			const variationValue = variation.name
				? [this.flagFactory({ label: `${JSON.stringify(variation.value)}`, ctxValue: 'value' })]
				: [];
			renderedVariations.push(
				this.flagFactory({
					label: `${variation.name ? variation.name : JSON.stringify(variation.value)}`,
					collapsed: variation.name ? COLLAPSED : NON_COLLAPSED,
					children: variationValue,
					ctxValue: 'name',
				}),
			);

			if (variation.description) {
				renderedVariations.push(
					this.flagFactory({
						label: `Description: ${variation.description}`,
						ctxValue: 'description',
					}),
				);
			}
		});
		renderedFlagFields.push(
			this.flagFactory({
				label: `Variations`,
				collapsed: COLLAPSED,
				children: renderedVariations,
				ctxValue: 'variation',
			}),
		);

		/**
		 * Show number of rules on the Flag
		 */
		renderedFlagFields.push(
			this.flagFactory({
				label: `Rule Count: ${envConfig.rules.length}`,
				ctxValue: 'flagRules',
			}),
		);

		/**
		 * Build Fallthrough view
		 */
		const fallThrough = envConfig.fallthrough;
		if (fallThrough.variation !== undefined) {
			const fallThroughVar = flag.variations[fallThrough.variation];
			renderedFlagFields.push(
				this.flagFactory({
					label: `Default Variation: ${
						fallThroughVar.name ? fallThroughVar.name : JSON.stringify(fallThroughVar.value)
					}`,
					ctxValue: 'variationDefault',
					flagKey: envConfig.key,
				}),
			);
		} else if (fallThrough.rollout) {
			const fallThroughRollout: Array<FlagNode> = [];
			if (fallThrough.rollout.bucketBy) {
				new FlagNode(this.ctx, `BucketBy: ${fallThrough.rollout.bucketBy}`, NON_COLLAPSED);
			}
			fallThrough.rollout.variations.map(variation => {
				const weight = variation.weight / 1000;
				const flagVariation = flag.variations[variation.variation];
				fallThroughRollout.push(
					this.flagFactory({ label: `Weight: ${weight} % `, ctxValue: 'weight' }),
					this.flagFactory({
						label: `Variation: ${flagVariation.name || JSON.stringify(flagVariation.value)}`,
						ctxValue: 'variation',
					}),
				);
			});
			renderedFlagFields.push(
				this.flagFactory({
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
			console.log(envConfig.offVariation)
			const offVar = flag.variations[envConfig.offVariation];
			if (offVar !== undefined) {
				renderedFlagFields.push(
					this.flagFactory({
						label: `Off Variation: ${offVar.name ? offVar.name : JSON.stringify(offVar.value)}`,
						ctxValue: 'variationOff',
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
				this.flagFactory({
					label: `Defaults`,
					collapsed: COLLAPSED,
					children: [
						this.flagFactory({
							label: `OnVariation: ${defOnVar.name ? defOnVar.name : JSON.stringify(defOnVar.value)}`,
							ctxValue: 'variation',
						}),
						this.flagFactory({
							label: `OffVariation: ${defOffVar.name ? defOffVar.name : JSON.stringify(defOffVar.value)}`,
							ctxValue: 'variation',
						}),
					],
				}),
			);
		}
		return item;
	}
}

/**
 * Factory function to generate FlagNode
 */
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
export class FlagNode extends vscode.TreeItem {
	children: any | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
	command?: vscode.Command;
	/**
	 * @param label will be shown in the Treeview
	 * @param collapsibleState is initial state collapsible state
	 * @param children array of FlagNode's building nested view
	 * @param contextValue maps to svg resources to show icons
	 * @param uri URI to build link for Open Browser
	 * @param flagKey reference to which flag key the treeview item is associated with
	 * @param flagParentName will match the flag name for top level tree item
	 */
	constructor(
		ctx: vscode.ExtensionContext,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		children?: any,
		contextValue?: string,
		uri?: string,
		flagKey?: string,
		flagParentName?: string,
		flagVersion?: number,
		command?: vscode.Command,
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

	private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, label: string, enabled?: boolean) {
		/**
		 * Special handling for open browser. Called in package.json
		 */
		if (contextValue == 'flagViewBrowser') {
			return;
		} else if (ctx && contextValue) {
			this.setIcon(ctx, contextValue);
		}
	}

	private setIcon(ctx: vscode.ExtensionContext, fileName: string): vscode.ThemeIcon {
		return (this.iconPath = {
			light: ctx.asAbsolutePath(path.join('resources', 'light', fileName + '.svg')),
			dark: ctx.asAbsolutePath(path.join('resources', 'dark', fileName + '.svg')),
		});
	}
}

export class FlagParentNode extends vscode.TreeItem {
	children: FlagNode[] | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
	enabled?: boolean;
	aliases?: string[]

	/**
	 * @param label will be shown in the Treeview
	 * @param collapsibleState is initial state collapsible state
	 * @param children array of FlagNode's building nested view
	 * @param flagKey reference to which flag key the treeview item is associated with
	 */
	constructor(
		ctx: vscode.ExtensionContext,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		children?: FlagNode[],
		flagKey?: string,
		flagVersion?: number,
		enabled?: boolean,
		aliases?: string[],
		contextValue?: string
	) {
		super(label, collapsibleState);
		this.children = children;
		this.flagKey = flagKey;
		this.flagVersion = flagVersion;
		this.enabled = enabled;
		this.contextValue = contextValue;
		this.conditionalIcon(ctx, this.contextValue, this.enabled);
		this.aliases = aliases
	}

	private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, enabled: boolean) {
		if (ctx && enabled) {
			this.setIcon(ctx, 'toggleon');
		} else if (ctx) {
			this.setIcon(ctx, 'toggleoff');
		}
	}

	private setIcon(ctx: vscode.ExtensionContext, fileName: string): vscode.ThemeIcon {
		return (this.iconPath = {
			light: ctx.asAbsolutePath(path.join('resources', 'light', fileName + '.svg')),
			dark: ctx.asAbsolutePath(path.join('resources', 'dark', fileName + '.svg')),
		});
	}
}

export interface FlagTreeInterface {
	children: any;
	command?: any;
	flagKey?: string;
	flagVersion?: number;
}
