import * as vscode from 'vscode';
import { FeatureFlag, FlagConfiguration } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';
import { debounce, map } from 'lodash';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagNode> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagNodes: Array<FlagNode>;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagNode | null | void> = new vscode.EventEmitter<FlagNode | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagNode | null | void> = this._onDidChangeTreeData.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, ctx: vscode.ExtensionContext) {
		this.api = api;
		this.config = config;
		this.ctx = ctx;
		this.flagStore = flagStore;
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
		this.refresh();
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				await this.getFlags();
				await this.flagUpdateListener();
			} catch (err) {
				console.error(err);
			}
		},
		200,
		{ leading: false, trailing: true },
	);

	getTreeItem(element: FlagNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlagNode): Thenable<FlagNode[]> {
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
			this.flagNodes = [this.flagFactory({ label: message })];
		}
		if (!this.flagNodes) {
			this.flagNodes = [new FlagNode(this.ctx, 'No Flags Found.', NON_COLLAPSED)];
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
		);
	}

	async start(): Promise<void> {
		if (!this.config.streamingConfigStartCheck()) {
			return;
		}
		await this.reload();
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
			if (flags.length != this.flagNodes.length) {
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

	private async flagToValues(flag: FeatureFlag, env: FlagConfiguration = null): Promise<FlagNode> {
		/**
		 * Get Link for Open Browser and build base flag node.
		 */
		let envConfig;
		if (env != null) {
			envConfig = env;
		} else {
			const env = await this.flagStore.getFeatureFlag(flag.key);
			envConfig = env.config;
		}

		const flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href;
		const item = this.flagFactory({
			label: flag.name,
			collapsed: COLLAPSED,
			children: [
				this.flagFactory({ label: `Open in Browser`, ctxValue: 'flagViewBrowser', uri: flagUri }),
				this.flagFactory({ label: `Key: ${flag.key}`, ctxValue: 'flagViewKey' }),
				this.flagFactory({
					label: `On: ${envConfig.on}`,
					ctxValue: 'flagViewToggle',
					flagKey: flag.key,
					flagParentName: flag.name,
				}),
			],
			ctxValue: 'flagParentItem',
			flagKey: flag.key,
			flagVersion: flag._version,
		});
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
				}),
			);
		}

		/**
		 * Build Off Variation view.
		 * TODO: Render even if undefined since that is valid option.
		 */
		if (flag.environments[this.config.env].offVariation !== undefined) {
			const offVar = flag.variations[flag.environments[this.config.env].offVariation];
			renderedFlagFields.push(
				this.flagFactory({
					label: `Off Variation: ${offVar.name ? offVar.name : JSON.stringify(offVar.value)}`,
					ctxValue: 'variationOff',
				}),
			);
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
	children: FlagNode[] | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
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
		children?: FlagNode[],
		contextValue?: string,
		uri?: string,
		flagKey?: string,
		flagParentName?: string,
		flagVersion?: number,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.children = children;
		this.uri = uri;
		this.flagKey = flagKey;
		this.flagParentName = flagParentName;
		this.flagVersion = flagVersion;
		this.conditionalIcon(ctx, this.contextValue, this.label);
	}

	private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, label: string) {
		/**
		 * Special handling for open browser. Called in package.json
		 */
		if (contextValue == 'flagViewBrowser') {
			return;
		}
		if (contextValue == 'flagViewToggle' && label.split(':')[1].trim() == 'false') {
			this.setIcon(ctx, 'toggleoff');
		} else if (this.contextValue == 'flagViewToggle') {
			this.setIcon(ctx, 'toggleon');
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
