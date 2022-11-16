import { debounce } from 'lodash';
import {
	ConfigurationChangeEvent,
	Event,
	EventEmitter,
	TreeItem,
	TreeDataProvider,
	window,
	Range,
	Command,
	TreeItemCollapsibleState,
	CancellationTokenSource,
	ExtensionContext,
} from 'vscode';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import { flagToValues } from '../utils/FlagNode';
import { FlagCodeLensProvider, SimpleCodeLens } from './flagLens';
import { FlagTreeInterface } from './flagsView';
import { FlagNode, FlagParentNode } from '../utils/FlagNode';
import { FlagAliases } from './codeRefs';

export class LaunchDarklyFlagListProvider implements TreeDataProvider<TreeItem> {
	private config: Configuration;
	private lens: FlagCodeLensProvider;
	private flagStore: FlagStore;
	private flagNodes: Array<FlagTreeInterface>;
	private aliases?: FlagAliases;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagMap: Map<string, FlagList | FlagNodeList> = new Map();
	constructor(
		config: Configuration,
		lens: FlagCodeLensProvider,
		flagStore: FlagStore,
		aliases?: FlagAliases,
	) {
		this.config = config;
		this.lens = lens;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.setFlagsinDocument();
		this.flagReadyListener();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	async reload(e?: ConfigurationChangeEvent | undefined): Promise<void> {
		if (e && this.config.streamingConfigReloadCheck(e)) {
			return;
		}
		await this.debouncedReload();
	}

	private readonly debouncedReload = debounce(
		async () => {
			try {
				this.refresh();
			} catch (err) {
				console.error(`Failed reloading Flagview: ${err}`);
			}
		},
		5000,
		{ leading: false, trailing: true },
	);

	async getTreeItem(element: TreeItem): Promise<TreeItem> {
		if (element.label == 'No Flags Found') {
			return element;
		}

		return element;
	}

	async getChildren(element?: FlagNode): Promise<TreeItem[]> {
		const items = [];
		if (typeof element !== 'undefined') {
			const child = this.flagMap.get(element.flagKey);
			child.list.forEach((entry) => {
				const newElement = new FlagItem(`Line: ${entry.end.line + 1}`, null, element.flagKey, [], entry, 'child');
				items.push(newElement);
			});
			return Promise.resolve(items);
		} else if (this.flagMap?.size > 0) {
			const CodeLensCmd = new TreeItem('Toggle Flag lens');
			CodeLensCmd.command = {
				title: 'Command',
				command: 'launchdarkly.enableCodeLens',
			};

			items.push(CodeLensCmd);
			this.flagMap.forEach((flag) => {
				items.push(flag);
			});
			return Promise.resolve(items);
		} else {
			return Promise.resolve([new TreeItem('No Flags found in file')]);
		}
	}

	public setFlagsinDocument = async (): Promise<void> => {
		this.refresh();
		this.flagNodes = [];
		this.flagMap = new Map();
		const editor = window.activeTextEditor;
		if (typeof editor === 'undefined' || typeof editor.document === 'undefined') {
			this.refresh();
			return;
		}
		const firstLine = editor.document.lineAt(0);
		if (firstLine.text.includes('DO NOT EDIT')) {
			this.refresh();
			return;
		}
		let flagsFound;
		const canceltoken = new CancellationTokenSource();
		try {
			flagsFound = await this.lens.ldCodeLens(editor.document, canceltoken.token, false);
		} catch (err) {
			// Try maximum of 2 times for lens to resolve
			flagsFound = await this.lens.ldCodeLens(editor.document, canceltoken.token, false);
		}
		if (typeof flagsFound === 'undefined') {
			this.refresh();
			return;
		}
		let flagMeta;

		try {
			flagMeta = await this.flagStore.allFlagsMetadata();
		} catch (err) {
			//nothing
		}

		flagsFound.map(async (flag) => {
			const codelensFlag = flag as FlagList;
			if (codelensFlag.flag) {
				const getElement = this.flagMap.get(codelensFlag.flag);
				if (getElement) {
					getElement.list.push(codelensFlag.range);
				} else {
					let newElement;
					if (typeof flagMeta !== 'undefined') {
						const flagEnv = await this.flagStore.getFlagConfig(codelensFlag.flag);
						newElement = (await flagToValues(flagMeta[codelensFlag.flag], flagEnv, this.config, this.aliases)) as FlagNodeList;
						newElement.list = [codelensFlag.range];
						this.flagNodes.push(newElement);
					} else {
						newElement = new FlagItem(codelensFlag.flag, TreeItemCollapsibleState.Collapsed, codelensFlag.flag, [
							codelensFlag.range,
						]);
					}

					this.flagMap.set(codelensFlag.flag, newElement);
				}
			}
		});

		this.refresh();
		return;
	};

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
						const existingFlag = this.flagMap.get(key);
						if (typeof existingFlag !== 'undefined') {
							flagToValues(updatedFlag.flag, updatedFlag.config, this.config, this.aliases).then((newFlagValue) => {
								const updatedFlagValue = newFlagValue as FlagNodeList;
								updatedFlagValue.list = existingFlag.list;
								this.flagMap.set(key, updatedFlagValue);
								this.refresh();
							});
						}
					});
				});
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag tree view:', err);
			}
		});
	}
}

class FlagList extends SimpleCodeLens {
	public list?: Array<Range>;
	public readonly name: string;
	public config: Configuration;
	constructor(
		range: Range,
		flag: string,
		name: string,
		config: Configuration,
		list?: Array<Range>,
		command?: Command | undefined,
	) {
		super(range, flag, config, command);
		this.list = list;
		this.name = name;
	}
}

export class FlagItem extends TreeItem {
	flagKey: string;
	range?: Range;
	contextValue?: string;
	list?: Array<Range>;
	constructor(
		public readonly label: string,
		public collapsibleState: TreeItemCollapsibleState,
		flagKey: string,
		list?: Array<Range>,
		range?: Range,
		contextValue?: string,
	) {
		super(label, collapsibleState);
		this.flagKey = flagKey;
		this.range = range;
		this.contextValue = contextValue;
		this.list = list;
	}
}

export class FlagNodeList extends FlagParentNode {
	public list?: Array<Range>;
	range?: Range;
	children: Array<FlagNode> | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;
	flagVersion: number;
	command?: Command;

	constructor(
		ctx: ExtensionContext,
		public readonly tooltip: string,
		public readonly label: string,
		public collapsibleState: TreeItemCollapsibleState,
		flagKey: string,
		uri: string,
		range?: Range,
		contextValue?: string,
		list?: Array<Range>,
		children?: FlagNode[],
		flagVersion?: number,
		enabled?: boolean,
		aliases?: string[],
	) {
		super(ctx, tooltip, label, uri, collapsibleState, children, flagKey, flagVersion, enabled, aliases, contextValue);
		this.flagKey = flagKey;
		this.range = range;
		this.contextValue = contextValue;
		this.list = list;
	}
}
