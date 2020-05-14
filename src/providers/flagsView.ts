import * as vscode from 'vscode';
import { FeatureFlag } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration, getIsTreeviewEnabled } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagValue> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagValues: Array<FlagValue>;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagValue | void> = new vscode.EventEmitter<FlagValue | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagValue | void> = this._onDidChangeTreeData.event;

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

	reload(): void {
		this.getFlags();
		this.refresh();
	}

	getTreeItem(element: FlagValue): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FlagValue): Thenable<FlagValue[]> {
		if (!this.flagValues) {
			return Promise.resolve([new FlagValue(this.ctx, 'No Flags Found.', NON_COLLAPSED)]);
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
		flags.map(flag => {
			let item = this.flagToValues(flag);
			flagValues.push(item);
		})
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
			COLLAPSED,
			[
				new FlagValue(this.ctx, `Open in Browser`, NON_COLLAPSED, [], 'flagViewBrowser', flagUri),
				new FlagValue(this.ctx, `Key: ${flag.key}`, NON_COLLAPSED, [], 'flagViewKey'),
				new FlagValue(
					this.ctx,
					`On: ${flag.environments[this.config.env].on}`,
					NON_COLLAPSED,
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
					NON_COLLAPSED,
					[],
					'flagDescription',
				),
			);
		}

		if (flag.tags.length > 0) {
			let tags: Array<FlagValue> = [];
			flag.tags.map(tag => {
				tags.push(new FlagValue(this.ctx, tag, NON_COLLAPSED, tags, 'flagTagItem'));
			});
			item.children.push(new FlagValue(this.ctx, `Tags`, COLLAPSED, tags, 'flagTags'));
		}
		var prereqs: Array<FlagValue> = [];
		let flagPrereqs = flag.environments[this.config.env].prerequisites;
		if (typeof flagPrereqs !== 'undefined' && flagPrereqs.length > 0) {
			flag.environments[this.config.env].prerequisites.map(prereq => {
				prereqs.push(new FlagValue(this.ctx, `Flag: ${prereq.key}`, NON_COLLAPSED));
				prereqs.push(new FlagValue(this.ctx, `Variation: ${prereq.variation}`, NON_COLLAPSED));
			});
			item.children.push(
				new FlagValue(this.ctx, `Prerequisites`, prereqs.length > 0 ? COLLAPSED : NON_COLLAPSED, prereqs, 'prereq'),
			);
		}

		var targets: Array<FlagValue> = [];
		var flagTargets = flag.environments[this.config.env].targets;
		if (typeof flagTargets !== 'undefined' && flagTargets.length > 0) {
			flagTargets.map(target => {
				targets.push(
					new FlagValue(
						this.ctx,
						`Variation: ${
						flag.variations[target.variation].name
							? flag.variations[target.variation].name
							: flag.variations[target.variation].value
						}`,
						NON_COLLAPSED,
						[],
						'variation',
					),
					new FlagValue(this.ctx, `Values: ${target.values}`, NON_COLLAPSED, [], 'value'),
				);
			});
			item.children.push(
				new FlagValue(this.ctx, `Targets`, targets.length > 0 ? COLLAPSED : NON_COLLAPSED, targets, 'targets'),
			);
		}

		var variations: Array<FlagValue> = [];
		flag.variations.map(variation => {
			var variationValue: FlagValue[];
			const flagName = variation.name;
			if (flagName) {
				variationValue = [new FlagValue(this.ctx, `${variation.value}`, NON_COLLAPSED, [], 'value')];
			}

			variations.push(
				new FlagValue(
					this.ctx,
					`${flagName ? flagName : variation.value}`,
					flagName ? COLLAPSED : NON_COLLAPSED,
					variationValue,
					'name',
				),
			);

			const flagDescription = variation.description;
			if (flagDescription) {
				variations.push(
					new FlagValue(
						this.ctx,
						`Description: ${flagDescription ? flagDescription : ''}`,
						NON_COLLAPSED,
						[],
						'flagDescription',
					),
				);
			}
		});
		item.children.push(new FlagValue(this.ctx, `Variations`, COLLAPSED, variations, 'variation'));

		item.children.push(
			new FlagValue(
				this.ctx,
				`Rule Count: ${flag.environments[this.config.env].rules.length}`,
				NON_COLLAPSED,
				[],
				'flagRules',
			),
		);

		let fallThrough = flag.environments[this.config.env].fallthrough;
		if (fallThrough.variation !== undefined) {
			const fallThroughVar = flag.variations[fallThrough.variation];
			item.children.push(
				new FlagValue(
					this.ctx,
					`Default Variation: ${fallThroughVar.name ? fallThroughVar.name : fallThroughVar.value}`,
					NON_COLLAPSED,
					[],
					'variationDefault',
				),
			);
		} else if (fallThrough.rollout) {
			let fallThroughRollout: Array<FlagValue> = [];
			if (fallThrough.rollout.bucketBy) {
				new FlagValue(this.ctx, `BucketBy: ${fallThrough.rollout.bucketBy}`, NON_COLLAPSED);
			}
			fallThrough.rollout.variations.map(variation => {
				let weight = variation.weight / 1000;
				const flagVariation = flag.variations[variation.variation];
				fallThroughRollout.push(
					new FlagValue(this.ctx, `Weight: ${weight}%`, NON_COLLAPSED, [], 'rolloutWeight'),
					new FlagValue(
						this.ctx,
						`Variation: ${flagVariation.name ? flagVariation.name : flagVariation.value}`,
						NON_COLLAPSED,
						[],
						'variation',
					),
				);
			});
			item.children.push(new FlagValue(this.ctx, `Default Rollout`, COLLAPSED, fallThroughRollout, 'rollout'));
		}

		if (flag.environments[this.config.env].offVariation !== undefined) {
			const offVar = flag.variations[flag.environments[this.config.env].offVariation];
			item.children.push(
				new FlagValue(
					this.ctx,
					`Off Variation: ${offVar.name ? offVar.name : offVar.value}`,
					NON_COLLAPSED,
					[],
					'variationOff',
				),
			);
		}

		if (flag.defaults !== undefined) {
			const defOnVar = flag.variations[flag.defaults.onVariation];
			const defOffVar = flag.variations[flag.defaults.offVariation];
			item.children.push(
				new FlagValue(this.ctx, `Defaults`, COLLAPSED, [
					new FlagValue(
						this.ctx,
						`OnVariation: ${defOnVar.name ? defOnVar.name : defOnVar.value}`,
						NON_COLLAPSED,
						[],
						'variation',
					),
					new FlagValue(
						this.ctx,
						`OffVariation: ${defOffVar.name ? defOffVar.name : defOffVar.value}`,
						NON_COLLAPSED,
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
