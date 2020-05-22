import * as vscode from 'vscode';
import { FeatureFlag } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';
import { debounce } from 'lodash';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagNode> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagNodes: Array<FlagNode>;
	private ctx: vscode.ExtensionContext;
	private readonly streamingConfigOptions = ['accessToken', 'baseUri', 'streamUri', 'project', 'env'];
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

	async reload(e?: vscode.ConfigurationChangeEvent | undefined) {
		if (e && this.streamingConfigOptions.every(option => !e.affectsConfiguration(`launchdarkly.${option}`))) {
			return;
		}
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				await this.flagStore.removeAll();
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
		if (!this.flagNodes) {
			return Promise.resolve([new FlagNode(this.ctx, 'No Flags Found.', NON_COLLAPSED)]);
		}

		return Promise.resolve(element ? element.children : this.flagNodes);
	}

	async getFlags() {
		try {
			const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
			this.flagNodes = flags.map(flag => this.flagToValues(flag));
		} catch (err) {
			console.error(err);
			let message = 'Error retrieving Flags';
			if (err.statusCode === 401) {
				message = 'Unauthorized';
			} else if (
				err.statusCode === 404 ||
				(err.statusCode === 400 && err.message.includes('Unknown environment key'))
			) {
				message = 'Configured environment does not exist.';
			}
			this.flagNodes = [this.flagFactory({ label: message })];
		}
		this.refresh();
	}

	registerTreeviewRefreshCommand(): vscode.Disposable {
		return vscode.commands.registerCommand('launchdarkly.treeviewrefresh', (): void => {
			this.reload();
			vscode.commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', this.config.enableFlagExplorer);
		});
	}

	async registerCommands() {
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

	async start() {
		if (!this.streamingConfigOptions.every(o => !!this.config[o])) {
			console.warn('LaunchDarkly extension is not configured. Language support is unavailable.');
			return;
		}

		await this.reload();
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.flagStore.on('update', async flag => {
			try {
				const updatedFlag = await this.api.getFeatureFlag(this.config.project, flag.key, this.config.env);
				const updatedIdx = this.flagNodes.findIndex(v => v.flagKey === updatedFlag.key);
				this.flagNodes[updatedIdx] = this.flagToValues(updatedFlag);
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
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
		});
	}

	private flagToValues(flag: FeatureFlag): FlagNode {
		/**
		 * Get Link for Open Browser and build base flag node.
		 */
		const flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href;
		var item = this.flagFactory({
			label: flag.name,
			collapsed: COLLAPSED,
			children: [
				this.flagFactory({ label: `Open in Browser`, ctxValue: 'flagViewBrowser', uri: flagUri }),
				this.flagFactory({ label: `Key: ${flag.key}`, ctxValue: 'flagViewKey' }),
				this.flagFactory({
					label: `On: ${flag.environments[this.config.env].on}`,
					ctxValue: 'flagViewToggle',
					flagKey: flag.key,
					flagParentName: flag.name,
				}),
			],
			ctxValue: 'flagParentItem',
			flagKey: flag.key,
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
		var prereqs: Array<FlagNode> = [];
		const flagPrereqs = flag.environments[this.config.env].prerequisites;
		if (typeof flagPrereqs !== 'undefined' && flagPrereqs.length > 0) {
			flag.environments[this.config.env].prerequisites.map(prereq => {
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
		var targets: Array<FlagNode> = [];
		var flagTargets = flag.environments[this.config.env].targets;
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
				label: `Rule Count: ${flag.environments[this.config.env].rules.length}`,
				ctxValue: 'flagRules',
			}),
		);

		/**
		 * Build Fallthrough view
		 */
		const fallThrough = flag.environments[this.config.env].fallthrough;
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
						label: `Variation: ${flagVariation.name ? flagVariation.name : JSON.stringify(flagVariation.value)}`,
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
export function flagNodeFactory({
	ctx = null,
	label = '',
	collapsed = NON_COLLAPSED,
	children = [],
	ctxValue = '',
	uri = '',
	flagKey = '',
	flagParentName = '',
}) {
	return new FlagNode(ctx, label, collapsed, children, ctxValue, uri, flagKey, flagParentName);
}

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
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.children = children;
		this.uri = uri;
		this.flagKey = flagKey;
		this.flagParentName = flagParentName;
		this.conditionalIcon(ctx, this.contextValue, this.label);
	}

	get tooltip(): string {
		return `${this.label}`;
	}

	private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, label: string) {
		if (contextValue == 'flagViewToggle' && label.split(':')[1].trim() == 'false') {
			this.setIcon(ctx, 'toggleoff');
		} else if (this.contextValue == 'flagViewToggle') {
			this.setIcon(ctx, 'toggleon');
		} else if (ctx) {
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
