import * as vscode from 'vscode';
import { FeatureFlag, FlagConfiguration, PatchComment } from '../models';
import { debounce, map } from 'lodash';
import checkExistingCommand from '../utils/common';
import { authentication } from 'vscode';
import { FlagNode, FlagParentNode, flagToValues } from '../utils/FlagNode';
import { generateHoverString } from '../utils/hover';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { flagCodeSearch, registerCommand } from '../utils';
import { logDebugMessage } from '../utils/logDebugMessage';
import { ReleaseFlagNode } from './releaseViewProvider';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyTreeViewProvider implements vscode.TreeDataProvider<FlagTreeInterface | FlagTreeInterface[]> {
	private readonly ldConfig: LDExtensionConfiguration;
	public flagNodes: Array<FlagTreeInterface> | null;
	private _onDidChangeTreeData: vscode.EventEmitter<FlagTreeInterface | null | void> =
		new vscode.EventEmitter<FlagTreeInterface | null | void>();
	readonly onDidChangeTreeData: vscode.Event<FlagTreeInterface | null | void> = this._onDidChangeTreeData.event;
	private updatingTree: vscode.EventEmitter<'started' | 'error' | 'complete'> = new vscode.EventEmitter();
	private lastTreeEvent: string;

	constructor(ldConfig: LDExtensionConfiguration) {
		this.ldConfig = ldConfig;
		this.registerCommands();
		this.start();
		this.treeLoader();
		authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id === 'launchdarkly') {
				const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
				if (session === undefined) {
					this.flagNodes = null;
					await this.refresh();
					await this.stop();
				}
			}
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	async reload(e?: vscode.ConfigurationChangeEvent | undefined): Promise<void> {
		if (e && this.ldConfig.getConfig()?.streamingConfigReloadCheck(e)) {
			return;
		}
		await this.debouncedReload();
	}

	async getTreeItem(element: FlagParentNode): Promise<vscode.TreeItem> {
		if (element.label == 'No Flags Found') {
			return element;
		}
		return element;
	}

	getParent(element: FlagNode): FlagParentNode | null {
		const parent = this.flagNodes?.findIndex((v) => v.flagKey === element.flagKey);
		return parent ? (this.flagNodes[parent] as FlagParentNode) : null;
	}

	treeLoader = () => {
		this.updatingTree.event((event) => {
			if (event === 'started') {
				this.flagNodes = [
					new FlagNode(
						this.ldConfig.getCtx(),
						'Retrieving flags it may be a moment...',
						NON_COLLAPSED,
						[],
						'',
						'',
						'',
						'',
						0,
						undefined,
					),
				];
				this.lastTreeEvent = event;
				this.refresh();
			} else {
				this.lastTreeEvent = event;
			}
		});
	};

	async getChildren(element?: FlagTreeInterface): Promise<FlagTreeInterface[] | undefined> {
		if (this.lastTreeEvent === 'started') {
			return Promise.resolve([
				new FlagNode(
					this.ldConfig.getCtx(),
					'Retrieving Flags it may be a moment...',
					NON_COLLAPSED,
					[],
					'',
					'',
					'',
					'',
					0,
					undefined,
				),
			]);
		}

		if (typeof this.flagNodes === 'undefined' || this.flagNodes?.length == 0) {
			return Promise.resolve([
				new FlagNode(
					this.ldConfig.getCtx(),
					'No Flags Found. Extension may need to be reconfigured.',
					NON_COLLAPSED,
					[],
					'',
					'',
					'',
					'',
					0,
					undefined,
				),
			]);
		}

		if (this.ldConfig.getConfig()?.isConfigured()) {
			if (typeof element !== 'undefined') {
				const getElement = element as FlagNode;
				if (getElement.children && getElement.children.length > 0) {
					return getElement.children as FlagNode[];
				} else {
					const updatedFlag = await this.ldConfig.getFlagStore()?.getFeatureFlag(element.flagKey);
					const updatedIdx = this.flagNodes?.findIndex((v) => v.flagKey === element.flagKey);
					if (!updatedFlag || updatedIdx == -1) {
						return [];
					}
					const newFlag = await flagToValues(
						updatedFlag.flag,
						updatedFlag.config,
						this.ldConfig,
						element as FlagParentNode,
					);
					if (this.flagNodes) {
						this.flagNodes[updatedIdx] = newFlag;
						return newFlag?.children;
					}
				}
			} else {
				return Promise.resolve(this.flagNodes as FlagParentNode[]);
			}
		}

		return [];
	}

	async getFlags(): Promise<void> {
		// Clear existing flags
		this.flagNodes = [];
		try {
			const nodes: FlagParentNode[] = [];
			if (this.ldConfig.getFlagStore()) {
				const flags = await this.ldConfig.getFlagStore()?.allFlagsMetadata();
				if (!flags) {
					return;
				}
				const checkFlags = Object.keys(flags)?.length;
				if (checkFlags == 0 && this.ldConfig.getConfig()?.isConfigured()) {
					// Attempt to reload once
					setInterval(async () => {
						await this.debouncedReload();
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
					this.updatingTree.fire('complete');
					this.refresh();
				}
			}
		} catch (err) {
			console.error(`Failed getting flags: ${err}`);
			const message = `Error retrieving Flags: ${err}`;
			this.updatingTree.fire('error');
			this.flagNodes = [new FlagParentNode(this.ldConfig.getCtx(), message, message, null, NON_COLLAPSED)];
		}
		if (this.ldConfig.getConfig()?.isConfigured() && !this.flagNodes) {
			this.flagNodes = [
				new FlagParentNode(this.ldConfig.getCtx(), 'No Flags Found.', 'No Flags Found', null, NON_COLLAPSED),
			];
		}
	}

	registerTreeviewRefreshCommand(): vscode.Disposable {
		return registerCommand('launchdarkly.treeviewrefresh', (): void => {
			this.reload();
			vscode.commands.executeCommand(
				'setContext',
				'launchdarkly:enableFlagExplorer',
				this.ldConfig.getConfig()?.enableFlagExplorer,
			);
		});
	}

	async registerCommands(): Promise<void> {
		// Check Copy Key only, if it exists the rest should also and registering commands should be skipped.
		const copyKeyCmd = 'launchdarkly.copyKey';
		if (await checkExistingCommand(copyKeyCmd)) {
			return;
		}
		this.ldConfig.getCtx().subscriptions.push(
			registerCommand(copyKeyCmd, (node: FlagNode) => vscode.env.clipboard.writeText(node.flagKey)),
			registerCommand('launchdarkly.openBrowser', (node: FlagNode | string) => {
				if (typeof node === 'string') {
					vscode.env.openExternal(vscode.Uri.parse(node));
				} else if (node.uri) {
					vscode.env.openExternal(vscode.Uri.parse(node.uri));
				}
			}),
			registerCommand('launchdarkly.refreshEntry', () => this.reload()),
			this.registerTreeviewRefreshCommand(),
			registerCommand('launchdarkly.flagMultipleSearch', (node: FlagNode | ReleaseFlagNode) => {
				if (!node.flagKey) {
					return;
				}
				flagCodeSearch(this.ldConfig, node.flagKey);
			}),
			registerCommand('launchdarkly.toggleFlag', async (node: FlagParentNode) => {
				try {
					if (!node.flagKey) {
						logDebugMessage('Flag key not found');
						return;
					}
					const env = await this.ldConfig.getFlagStore()?.getFeatureFlag(node.flagKey);
					logDebugMessage(
						`Flag key: ${node.flagKey}, Project: ${this.ldConfig.getConfig()?.project}, On: ${!env?.config.on}`,
					);
					await this.ldConfig
						.getApi()
						?.patchFeatureFlagOn(this.ldConfig.getConfig()!.project, node.flagKey, !env?.config.on);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not toggle flag: ${err.message}`);
				}
			}),
			registerCommand('launchdarkly.fallthroughChange', async (node: FlagNode) => {
				try {
					await this.flagPatch(
						node,
						`/environments/${this.ldConfig.getConfig()?.env}/fallthrough/variation`,
						node.contextValue,
					);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not set Fallthrough: ${err.message}`);
				}
			}),
			registerCommand('launchdarkly.offChange', async (node: FlagNode) => {
				try {
					await this.flagPatch(node, `/environments/${this.ldConfig.getConfig()?.env}/offVariation`, node.contextValue);
				} catch (err) {
					vscode.window.showErrorMessage(`Could not set Off Variation: ${err.message}`);
				}
			}),
		);
	}

	async start(): Promise<void> {
		if (!(await this.ldConfig.getConfig().isConfigured())) {
			return;
		}
		await this.reload();
	}

	async stop(): Promise<void> {
		this.flagNodes = [];
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				this.updatingTree.fire('started');
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

	private async flagPatch(node: FlagTreeInterface, path: string, contextValue?: string): Promise<void> {
		if (!node.flagKey) {
			return;
		}
		const env = await this.ldConfig.getFlagStore()?.getFeatureFlag(node.flagKey);

		const variations = env?.flag.variations?.map((variation, idx) => {
			return `${idx}. ${
				JSON.stringify(variation.name) ? JSON.stringify(variation.name) : JSON.stringify(variation.value)
			}`;
		});
		if (!variations) {
			return;
		}

		const choice = await vscode.window.showQuickPick(variations);
		if (!choice) {
			return;
		}

		const newValue = choice.split('.')[0];
		const patch: { op: string; path: string; value?: number }[] = [];
		patch.push({ op: 'replace', path: path, value: parseInt(newValue) });

		if (contextValue && contextValue === 'rollout') {
			patch.push({ op: 'remove', path: `/environments/${this.ldConfig.getConfig()?.env}/fallthrough/rollout` });
		}
		const patchComment = new PatchComment();
		patchComment.comment = 'Update by VSCode';
		patchComment.patch = patch;
		try {
			await this.ldConfig.getApi()?.patchFeatureFlag(this.ldConfig.getConfig().project, node.flagKey, patchComment);
		} catch (err) {
			if (err.statusCode === 403) {
				vscode.window.showErrorMessage('Unauthorized: Your key does not have permissions to change the flag.', err);
			} else {
				vscode.window.showErrorMessage(`Could not update flag: ${err.message}`);
			}
		}
	}

	private async flagReadyListener() {
		this.ldConfig.getFlagStore()?.ready?.event(async () => {
			try {
				this.flagUpdateListener();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
		});
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.ldConfig.getFlagStore()?.on('update', async (keys: string) => {
			try {
				const flagKeys = Object.values(keys);
				flagKeys.map((key) => {
					logDebugMessage(`Flag update detected for ${key}`);
					this.ldConfig
						.getFlagStore()
						?.getFeatureFlag(key)
						.then((updatedFlag) => {
							const updatedIdx = this.flagNodes.findIndex((v) => v.flagKey === key);
							flagToValues(updatedFlag.flag, updatedFlag.config, this.ldConfig).then((newFlagValue) => {
								this.flagNodes[updatedIdx] = newFlagValue;
							});
						});
				});
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
		});
		this.ldConfig.getFlagStore()?.storeUpdates.event(async () => {
			const flags = await this.ldConfig.getFlagStore()?.allFlagsMetadata();
			if (flags && Object.keys(flags).length !== this.flagNodes?.length) {
				const nodes: FlagParentNode[] = [];
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
							const updatedIdx = this.flagNodes?.findIndex((v) => v.flagKey === flag.key);
							if (this.flagNodes[updatedIdx].flagVersion < flag._version) {
								this.flagNodes[updatedIdx] = await this.flagToParent(flag);
							}
						};
					}),
				);
			}
			this.refresh();
		});
		if (this.ldConfig.getAliases()) {
			this.ldConfig.getAliases()!.aliasUpdates.event(async () => {
				this.reload();
			});
		}
	}

	private async flagToParent(flag: FeatureFlag, env: FlagConfiguration | null = null): Promise<FlagParentNode> {
		let envConfig;
		if (env !== null) {
			envConfig = env;
		} else {
			try {
				const env = await this.ldConfig.getFlagStore()?.getFeatureFlag(flag.key);
				envConfig = env.config;
			} catch (err) {
				envConfig = new FlagConfiguration();
			}
		}

		const item = new FlagParentNode(
			this.ldConfig.getCtx(),
			flag.name,
			generateHoverString(flag, envConfig, this.ldConfig),
			`${this.ldConfig.getSession()?.fullUri}/${this.ldConfig.getConfig()?.project}/${this.ldConfig.getConfig()
				?.env}/features/${flag.key}`,
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
