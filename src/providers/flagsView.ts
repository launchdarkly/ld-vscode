import * as vscode from 'vscode';
import { FeatureFlag, FlagConfiguration, PatchComment } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import { debounce, map } from 'lodash';
import { FlagAliases } from './codeRefs';
import checkExistingCommand from '../utils/common';
import { Command } from 'vscode';
import { FlagNode, FlagParentNode, flagToValues } from '../utils/FlagNode';
import { generateHoverString } from '../utils/hover';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagTreeInterface | FlagTreeInterface[]> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private flagNodes: Array<FlagTreeInterface>;
	private aliases: FlagAliases;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagTreeInterface | null | void> =
		new vscode.EventEmitter<FlagTreeInterface | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagTreeInterface | null | void> = this._onDidChangeTreeData.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, aliases?: FlagAliases) {
		this.api = api;
		this.config = config;
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
				await this.flagReadyListener();
				await this.flagUpdateListener();
				this.refresh();
			} catch (err) {
				console.error(`Failed reloading Flagview: ${err}`);
			}
		},
		5000,
		{ leading: false, trailing: true },
	);

	async getTreeItem(element: FlagParentNode): Promise<vscode.TreeItem> {
		if (element.label == 'No Flags Found') {
			return element;
		}

		return element;
	}

	getParent(element: FlagNode): FlagParentNode | null {
		const parent = this.flagNodes.findIndex((v) => v.flagKey === element.flagKey);
		return parent ? (this.flagNodes[parent] as FlagParentNode) : null;
	}

	async getChildren(element?: FlagTreeInterface): Promise<FlagTreeInterface[]> {
		if (this.config.isConfigured() && (typeof this.flagNodes === 'undefined' || this.flagNodes.length == 0)) {
			const linkUrl = `${this.config.baseUri}/${this.config.project}/${this.config.env}/get-started/connect-an-sdk`;
			const QuickStartCmd: Command = {
				title: 'Open QuickStart',
				command: 'launchdarkly.openBrowser',
				arguments: [linkUrl],
			};
			return Promise.resolve([
				new FlagNode(
					global.ldContext,
					'No Flags Found. Click here to view Quickstart',
					NON_COLLAPSED,
					[],
					'',
					'',
					'',
					'',
					0,
					QuickStartCmd,
				),
			]);
		}

		if (typeof element !== 'undefined') {
			const getElement = element as FlagNode;
			if (getElement.children.length > 0) {
				return getElement.children as FlagNode[];
			} else {
				const updatedFlag = await this.flagStore.getFeatureFlag(element.flagKey);
				const updatedIdx = this.flagNodes.findIndex((v) => v.flagKey === element.flagKey);
				const newFlag = await flagToValues(
					updatedFlag.flag,
					updatedFlag.config,
					this.config,
					this.aliases,
					element as FlagParentNode,
				);
				this.flagNodes[updatedIdx] = newFlag;
				return newFlag.children;
			}
		} else {
			return Promise.resolve(this.flagNodes as FlagParentNode[]);
		}
	}

	setFlagsStore(flagstore: FlagStore): void {
		this.flagStore = flagstore;
		this.flagUpdateListener();
	}

	async getFlags(): Promise<void> {
		// Clear existing flags
		this.flagNodes = [];
		try {
			const nodes = [];
			if (this.flagStore) {
				const flags = await this.flagStore.allFlagsMetadata();
				const checkFlags = Object.keys(flags)?.length;
				if (checkFlags == 0 && this.config.isConfigured()) {
					setInterval(() => {
						this.debouncedReload();
					}, 5000);
				}

				if (checkFlags > 0) {
					map(flags, (value) => {
						setImmediate(() => {
							this.flagToParent(value).then((node) => {
								nodes.push(node);
							});
						});
					});
					this.flagNodes = nodes;
					this.refresh();
				}
			}
		} catch (err) {
			console.error(`Failed getting flags: ${err}`);
			const message = `Error retrieving Flags: ${err}`;
			this.flagNodes = [new FlagParentNode(global.ldContext, message, message, null, NON_COLLAPSED)];
		}
		if (this.config.isConfigured() && !this.flagNodes) {
			this.flagNodes = [new FlagParentNode(global.ldContext, 'No Flags Found.', 'No Flags Found', null, NON_COLLAPSED)];
		}
	}

	registerTreeviewRefreshCommand(): vscode.Disposable {
		return vscode.commands.registerCommand('launchdarkly.treeviewrefresh', (): void => {
			this.reload();
			vscode.commands.executeCommand('setContext', 'launchdarkly:enableFlagExplorer', this.config.enableFlagExplorer);
		});
	}

	async registerCommands(): Promise<void> {
		// Check Copy Key only, if it exists the rest should also and registering commands should be skipped.
		const copyKeyCmd = 'launchdarkly.copyKey';
		if (await checkExistingCommand(copyKeyCmd)) {
			return;
		}
		global.ldContext.subscriptions.push(
			vscode.commands.registerCommand(copyKeyCmd, (node: FlagNode) => vscode.env.clipboard.writeText(node.flagKey)),
			vscode.commands.registerCommand('launchdarkly.openBrowser', (node: FlagNode | string) => {
				if (typeof node === 'string') {
					vscode.env.openExternal(vscode.Uri.parse(node));
				} else {
					vscode.env.openExternal(vscode.Uri.parse(node.uri));
				}
			}),
			vscode.commands.registerCommand('launchdarkly.refreshEntry', () => this.reload()),
			this.registerTreeviewRefreshCommand(),
			vscode.commands.registerCommand('launchdarkly.flagMultipleSearch', (node: FlagNode) => {
				let aliases;
				let findAliases: string;
				if (this.aliases) {
					aliases = this.aliases.getKeys();
				}
				if (aliases && aliases[node.flagKey]) {
					const tempSearch = [...aliases[node.flagKey]];
					tempSearch.push(node.flagKey);
					findAliases = tempSearch.join('|');
				} else {
					findAliases = node.flagKey;
				}
				vscode.commands.executeCommand('workbench.action.findInFiles', {
					query: findAliases,
					triggerSearch: true,
					matchWholeWord: true,
					isCaseSensitive: true,
					isRegex: true,
				});
			}),
			vscode.commands.registerCommand('launchdarkly.toggleFlag', async (node: FlagParentNode) => {
				try {
					const env = await this.flagStore.getFeatureFlag(node.flagKey);
					await this.api.patchFeatureFlagOn(this.config.project, node.flagKey, !env.config.on);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not toggle flag: ${err.message}`);
				}
			}),
			vscode.commands.registerCommand('launchdarkly.user.fallthroughChange', async (node: FlagNode) => {
				try {
					await this.flagPatch(node, `/environments/${this.config.env}/fallthrough/variation`, node.contextValue);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not set Fallthrough: ${err.message}`);
				}
			}),
			vscode.commands.registerCommand('launchdarkly.user.offChange', async (node: FlagNode) => {
				try {
					await this.flagPatch(node, `/environments/${this.config.env}/offVariation`, node.contextValue);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not set Off Variation: ${err.message}`);
				}
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
			return `${idx}. ${
				JSON.stringify(variation.name) ? JSON.stringify(variation.name) : JSON.stringify(variation.value)
			}`;
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
			await this.api.patchFeatureFlag(this.config.project, node.flagKey, patchComment);
		} catch (err) {
			if (err.statusCode === 403) {
				vscode.window.showErrorMessage('Unauthorized: Your key does not have permissions to change the flag.', err);
			} else {
				vscode.window.showErrorMessage(`Could not update flag: ${err.message}`);
			}
		}
	}

	private async flagReadyListener() {
		this.flagStore.storeReady.event(async () => {
			try {
				this.flagUpdateListener();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
		});
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.flagStore.on('update', async (keys: string) => {
			try {
				const flagKeys = Object.values(keys);
				flagKeys.map((key) => {
					this.flagStore.getFeatureFlag(key).then((updatedFlag) => {
						const updatedIdx = this.flagNodes.findIndex((v) => v.flagKey === key);
						flagToValues(updatedFlag.flag, updatedFlag.config, this.config, this.aliases).then((newFlagValue) => {
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
			if (flags?.length !== this.flagNodes.length) {
				const nodes = [];
				map(flags, (value) => {
					setImmediate(() => {
						this.flagToParent(value).then((node) => {
							nodes.push(node);
						});
					});
				});
				this.flagNodes = nodes;
			} else {
				map(
					flags,
					setImmediate(() => {
						async (flag) => {
							const updatedIdx = this.flagNodes.findIndex((v) => v.flagKey === flag.key);
							if (this.flagNodes[updatedIdx].flagVersion < flag._version) {
								this.flagNodes[updatedIdx] = await this.flagToParent(flag);
							}
						};
					}),
				);
			}
			this.refresh();
		});
		if (this.aliases) {
			this.aliases.aliasUpdates.event(async () => {
				this.reload();
			});
		}
	}

	private async flagToParent(flag: FeatureFlag, env: FlagConfiguration = null): Promise<FlagParentNode> {
		let envConfig;
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

		const item = new FlagParentNode(
			global.ldContext,
			flag.name,
			generateHoverString(flag, envConfig, this.config, global.ldContext),
			`${this.config.baseUri}/${this.config.project}/${this.config.env}/features/${flag.key}`,
			COLLAPSED,
			[],
			flag.key,
			flag._version,
			envConfig.on,
			[],
			'flagParentItem',
		);

		return item;
	}
}

export interface FlagTreeInterface {
	children: unknown;
	command?: unknown;
	flagKey?: string;
	flagVersion?: number;
}
