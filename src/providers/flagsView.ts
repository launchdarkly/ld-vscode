import * as vscode from 'vscode';
import { FeatureFlag } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';
import { debounce } from 'lodash';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagValue> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagValues: Array<FlagValue>;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagValue | null | void> = new vscode.EventEmitter<FlagValue | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagValue | null | void> = this._onDidChangeTreeData.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, ctx: vscode.ExtensionContext) {
		this.api = api;
		this.config = config;
		this.ctx = ctx;
		this.flagStore = flagStore;
		this.start();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	async reload() {
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(async () => {
		try {
			await this.flagStore.removeAll()
			await this.getFlags();
			await this.flagUpdateListener();
		} catch (err) {
			console.error(err)
		}
	}, 200, { leading: false, trailing: true });

	getTreeItem(element: FlagValue): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlagValue): Thenable<FlagValue[]> {
		if (!this.flagValues) {
			return Promise.resolve([new FlagValue(this.ctx, 'No Flags Found.', NON_COLLAPSED)]);
		}

		return Promise.resolve(element ? element.children : this.flagValues);
	}

	async getFlags() {
		try {
			const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
			this.flagValues = flags.map(flag => this.flagToValues(flag));
			this.refresh();
		} catch (err) {
			console.error(err)
		}
	}

	registerTreeviewRefreshCommand(): vscode.Disposable {
		return vscode.commands.registerCommand('launchdarkly.treeviewrefresh', (): void => {
			this.reload();
			vscode.commands.executeCommand('setContext', 'launchdarkly:enableFlagTreeview', this.config.enableFlagTreeview);
		});
	}

	async start() {
		this.ctx.subscriptions.push(
			vscode.commands.registerCommand('launchdarkly.copyKey', (node: FlagValue) =>
				vscode.env.clipboard.writeText(node.label.split(':')[1].trim()),
			),
			vscode.commands.registerCommand('launchdarkly.openBrowser', (node: FlagValue) =>
				vscode.env.openExternal(vscode.Uri.parse(node.uri)),
			),
			vscode.commands.registerCommand('launchdarkly.refreshEntry', () => this.reload()),
			this.registerTreeviewRefreshCommand(),
		);

		await this.flagUpdateListener()

		this.getFlags();
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.flagStore.on('update', async flag => {
			try {
				const updatedFlag = await this.api.getFeatureFlag(this.config.project, flag.key, this.config.env);
				const updatedIdx = this.flagValues.findIndex(v => v.flagKey === updatedFlag.key);
				this.flagValues[updatedIdx] = this.flagToValues(updatedFlag);
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
		return flagValueFactory({
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

	private flagToValues(flag: FeatureFlag): FlagValue {
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
		const renderedFlagFields = item.children;
		if (flag.description) {
			renderedFlagFields.push(
				this.flagFactory({
					label: `Description: ${flag.description ? flag.description : ''}`,
					ctxValue: 'flagDescription',
				}),
			);
		}

		const tags: Array<FlagValue> = flag.tags.map(tag => this.flagFactory({ label: tag, ctxValue: 'flagTagItem' }));
		renderedFlagFields.push(this.flagFactory({ label: `Tags`, children: tags, collapsed: COLLAPSED, ctxValue: 'flagTags' }));

		var prereqs: Array<FlagValue> = [];
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

		var targets: Array<FlagValue> = [];
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

		const renderedVariations: Array<FlagValue> = [];
		flag.variations.forEach(variation => {
			const variationValue = variation.name ? [this.flagFactory({ label: `${JSON.stringify(variation.value)}`, ctxValue: 'value' })] : [];
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
			this.flagFactory({ label: `Variations`, collapsed: COLLAPSED, children: renderedVariations, ctxValue: 'variation' }),
		);

		renderedFlagFields.push(
			this.flagFactory({
				label: `Rule Count: ${flag.environments[this.config.env].rules.length}`,
				ctxValue: 'flagRules',
			}),
		);

		const fallThrough = flag.environments[this.config.env].fallthrough;
		if (fallThrough.variation !== undefined) {
			const fallThroughVar = flag.variations[fallThrough.variation];
			renderedFlagFields.push(
				this.flagFactory({
					label: `Default Variation: ${fallThroughVar.name ? fallThroughVar.name : JSON.stringify(fallThroughVar.value)}`,
					ctxValue: 'variationDefault',
				}),
			);
		} else if (fallThrough.rollout) {
			const fallThroughRollout: Array<FlagValue> = [];
			if (fallThrough.rollout.bucketBy) {
				new FlagValue(this.ctx, `BucketBy: ${fallThrough.rollout.bucketBy}`, NON_COLLAPSED);
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

		if (flag.environments[this.config.env].offVariation !== undefined) {
			const offVar = flag.variations[flag.environments[this.config.env].offVariation];
			renderedFlagFields.push(
				this.flagFactory({
					label: `Off Variation: ${offVar.name ? offVar.name : JSON.stringify(offVar.value)}`,
					ctxValue: 'variationOff',
				}),
			);
		}

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

export function flagValueFactory({
	ctx = null,
	label = '',
	collapsed = NON_COLLAPSED,
	children = [],
	ctxValue = '',
	uri = '',
	flagKey = '',
	flagParentName = '',
}) {
	return new FlagValue(ctx, label, collapsed, children, ctxValue, uri, flagKey, flagParentName);
}

export class FlagValue extends vscode.TreeItem {
	children: FlagValue[] | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;

	constructor(
		ctx: vscode.ExtensionContext,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		children?: FlagValue[],
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
