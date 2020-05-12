import * as vscode from 'vscode';
import { FeatureFlag } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration, getIsTreeviewEnabled } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagValue> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagValues: Array<FlagValue>;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagValue | undefined> = new vscode.EventEmitter<
		FlagValue | undefined
	>();
	readonly onDidChangeTreeData: vscode.Event<FlagValue | undefined> = this._onDidChangeTreeData.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, ctx: vscode.ExtensionContext) {
		this.api = api;
		this.config = config;
		this.ctx = ctx;
		this.flagStore = flagStore;
		this.start();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	reload(): void {
		this.getFlags();
		this.refresh();
	}

	getTreeItem(element: FlagValue): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlagValue): Thenable<FlagValue[]> {
		if (!this.flagValues) {
			return Promise.resolve([new FlagValue(this.ctx, 'No Flags Found.', vscode.TreeItemCollapsibleState.None)]);
		}

		if (element) {
			return Promise.resolve(element.children);
		} else {
			return Promise.resolve(
				this.flagValues.map(function (flag) {
					return flag;
				}),
			);
		}
	}

	async getFlags() {
		const flags = await this.api.getFeatureFlags(this.config.project, this.config.env);
		let flagValues = [];
		for (const flag of flags) {
			let item = this.flagToValues(flag);
			flagValues.push(item);
		}
		this.flagValues = flagValues;
		this.refresh();
	}

	async start() {
		this.ctx.subscriptions.push(
			vscode.commands.registerCommand('launchdarkly.copyKey', (node: FlagValue) =>
				vscode.env.clipboard.writeText(node.label.split(':')[1].trim()),
			),
			vscode.commands.registerCommand('launchdarkly.openBrowser', (node: FlagValue) =>
				vscode.env.openExternal(vscode.Uri.parse(node.uri)),
			),
			vscode.commands.registerCommand('launchdarkly.refreshEntry', () => this.refresh()),
			registerTreeviewRefreshCommand(this),
		);

		// Setup listener for flag changes
		this.flagStore.on('update', async flag => {
			try {
				const updatedFlag = await this.api.getFeatureFlag(this.config.project, flag.key, this.config.env);
				const updatedIdx = this.flagValues.findIndex(v => v.flagKey === updatedFlag.key);
				this.flagValues[updatedIdx] = this.flagToValues(updatedFlag);
				this.refresh();
			} catch (err) {
				console.log(err);
				// TODO: handle error
			}
		});

		this.getFlags();
	}

	private flagToValues(flag: FeatureFlag): FlagValue {
		let flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href;
		var item = new FlagValue(
			this.ctx,
			flag.name,
			vscode.TreeItemCollapsibleState.Collapsed,
			[
				new FlagValue(
					this.ctx,
					`Open in Browser`,
					vscode.TreeItemCollapsibleState.None,
					[],
					'flagViewBrowser',
					flagUri,
				),
				new FlagValue(this.ctx, `Key: ${flag.key}`, vscode.TreeItemCollapsibleState.None, [], 'flagViewKey'),
				new FlagValue(
					this.ctx,
					`On: ${flag.environments[this.config.env].on}`,
					vscode.TreeItemCollapsibleState.None,
					[],
					'flagViewToggle',
					'',
					flag.key,
					flag.name,
				),
			],
			'flagParentItem',
			'',
			flag.key,
		);
		if (flag.description) {
			item.children.push(
				new FlagValue(
					this.ctx,
					`Description: ${flag.description ? flag.description : ''}`,
					vscode.TreeItemCollapsibleState.None,
					[],
					'flagDescription',
				),
			);
		}

		if (flag.tags.length > 0) {
			let tags: Array<FlagValue> = [];
			for (let i = 0; i < flag.tags.length; i++) {
				tags.push(new FlagValue(this.ctx, flag.tags[i], vscode.TreeItemCollapsibleState.None, tags, 'flagTagItem'));
			}
			item.children.push(new FlagValue(this.ctx, `Tags`, vscode.TreeItemCollapsibleState.Collapsed, tags, 'flagTags'));
		}
		var prereqs: Array<FlagValue> = [];
		let flagPrereqs = flag.environments[this.config.env].prerequisites;
		if (typeof flagPrereqs !== 'undefined' && flagPrereqs.length > 0) {
			for (let i = 0; i < flag.environments[this.config.env].prerequisites.length; i++) {
				prereqs.push(
					new FlagValue(
						this.ctx,
						`Flag: ${flag.environments[this.config.env].prerequisites[i].key}`,
						vscode.TreeItemCollapsibleState.None,
					),
				);
				prereqs.push(
					new FlagValue(
						this.ctx,
						`Variation: ${flag.environments[this.config.env].prerequisites[i].variation}`,
						vscode.TreeItemCollapsibleState.None,
					),
				);
			}
			item.children.push(
				new FlagValue(
					this.ctx,
					`Prerequisites`,
					prereqs.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
					prereqs,
					'prereq',
				),
			);
		}

		var targets: Array<FlagValue> = [];
		var flagTargets = flag.environments[this.config.env].targets;
		if (typeof flagTargets !== 'undefined' && flagTargets.length > 0) {
			for (let i = 0; i < flagTargets.length; i++) {
				let curTarget = flagTargets[i];
				targets.push(
					new FlagValue(
						this.ctx,
						`Variation: ${
						flag.variations[curTarget.variation].name
							? flag.variations[curTarget.variation].name
							: flag.variations[curTarget.variation].value
						}`,
						vscode.TreeItemCollapsibleState.None,
						[],
						'variation',
					),
					new FlagValue(this.ctx, `Values: ${curTarget.values}`, vscode.TreeItemCollapsibleState.None, [], 'value'),
				);
			}
			item.children.push(
				new FlagValue(
					this.ctx,
					`Targets`,
					targets.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
					targets,
					'targets',
				),
			);
		}

		var variations: Array<FlagValue> = [];
		for (let i = 0; i < flag.variations.length; i++) {
			var variationValue: FlagValue[];
			if (flag.variations[i].name) {
				variationValue = [
					new FlagValue(this.ctx, `${flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None, [], 'value'),
				];
			}

			variations.push(
				new FlagValue(
					this.ctx,
					`${flag.variations[i].name ? flag.variations[i].name : flag.variations[i].value}`,
					flag.variations[i].name ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
					variationValue,
					'name',
				),
			);

			// variations.push(
			//   new FlagValue(this.ctx, `Value: ${flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None, [], 'value')
			// )
			if (flag.variations[i].description) {
				variations.push(
					new FlagValue(
						this.ctx,
						`Description: ${flag.variations[i].description ? flag.variations[i].description : ''}`,
						vscode.TreeItemCollapsibleState.None,
						[],
						'flagDescription',
					),
				);
			}
		}
		item.children.push(
			new FlagValue(this.ctx, `Variations`, vscode.TreeItemCollapsibleState.Collapsed, variations, 'variation'),
		);

		item.children.push(
			new FlagValue(
				this.ctx,
				`Rule Count: ${flag.environments[this.config.env].rules.length}`,
				vscode.TreeItemCollapsibleState.None,
				[],
				'flagRules',
			),
		);

		let fallThrough = flag.environments[this.config.env].fallthrough;
		if (fallThrough.variation !== undefined) {
			item.children.push(
				new FlagValue(
					this.ctx,
					`Default Variation: ${
					flag.variations[fallThrough.variation].name
						? flag.variations[fallThrough.variation].name
						: flag.variations[fallThrough.variation].value
					}`,
					vscode.TreeItemCollapsibleState.None,
					[],
					'variationDefault',
				),
			);
		} else if (fallThrough.rollout) {
			let fallThroughRollout: Array<FlagValue> = [];
			if (fallThrough.rollout.bucketBy) {
				new FlagValue(this.ctx, `BucketBy: ${fallThrough.rollout.bucketBy}`, vscode.TreeItemCollapsibleState.None);
			}
			for (let k = 0; k < fallThrough.rollout.variations.length; k++) {
				let weight = fallThrough.rollout.variations[k].weight / 1000;
				fallThroughRollout.push(
					new FlagValue(this.ctx, `Weight: ${weight}%`, vscode.TreeItemCollapsibleState.None, [], 'rolloutWeight'),
					new FlagValue(
						this.ctx,
						`Variation: ${
						flag.variations[fallThrough.rollout.variations[k].variation].name
							? flag.variations[fallThrough.rollout.variations[k].variation].name
							: flag.variations[fallThrough.rollout.variations[k].variation].value
						}`,
						vscode.TreeItemCollapsibleState.None,
						[],
						'variation',
					),
				);
			}
			item.children.push(
				new FlagValue(
					this.ctx,
					`Default Rollout`,
					vscode.TreeItemCollapsibleState.Collapsed,
					fallThroughRollout,
					'rollout',
				),
			);
		}

		if (flag.environments[this.config.env].offVariation !== undefined) {
			item.children.push(
				new FlagValue(
					this.ctx,
					`Off Variation: ${
					flag.variations[flag.environments[this.config.env].offVariation].name
						? flag.variations[flag.environments[this.config.env].offVariation].name
						: flag.variations[flag.environments[this.config.env].offVariation].value
					}`,
					vscode.TreeItemCollapsibleState.None,
					[],
					'variationOff',
				),
			);
		}

		if (flag.defaults !== undefined) {
			item.children.push(
				new FlagValue(this.ctx, `Defaults`, vscode.TreeItemCollapsibleState.Collapsed, [
					new FlagValue(
						this.ctx,
						`OnVariation: ${
						flag.variations[flag.defaults.onVariation].name
							? flag.variations[flag.defaults.onVariation].name
							: flag.variations[flag.defaults.onVariation].value
						}`,
						vscode.TreeItemCollapsibleState.None,
						[],
						'variation',
					),
					new FlagValue(
						this.ctx,
						`OffVariation: ${
						flag.variations[flag.defaults.offVariation].name
							? flag.variations[flag.defaults.offVariation].name
							: flag.variations[flag.defaults.offVariation].value
						}`,
						vscode.TreeItemCollapsibleState.None,
						[],
						'variation',
					),
				]),
			);
		}
		return item;
	}
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

export function registerTreeviewRefreshCommand(treeDataProvider: LaunchDarklyTreeViewProvider): vscode.Disposable {
	return vscode.commands.registerCommand('launchdarkly.treeviewrefresh', (): void => {
		treeDataProvider.reload();
		vscode.commands.executeCommand('setContext', 'launchdarkly:enableFlagTreeview', getIsTreeviewEnabled());
	});
}
