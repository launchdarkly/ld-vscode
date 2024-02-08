import { Dictionary, debounce } from 'lodash';
import {
	Event,
	EventEmitter,
	TreeItem,
	TreeDataProvider,
	window,
	Range,
	Command,
	TreeItemCollapsibleState,
	CancellationTokenSource,
	authentication,
	workspace,
	ConfigurationChangeEvent,
	TreeItemLabel,
} from 'vscode';
import { Configuration } from '../configuration';
import { flagToValues } from '../utils/FlagNode';
import { FlagCodeLensProvider, SimpleCodeLens } from './flagLens';
import { FlagNode } from '../utils/FlagNode';
import { FeatureFlag, IFlagTree, ILDExtensionConfiguration } from '../models';
import { logDebugMessage } from '../utils/logDebugMessage';
import { CMD_LD_ENABLE_LENS } from '../utils/commands';

export class LaunchDarklyFlagListProvider implements TreeDataProvider<TreeItem> {
	private ldConfig: ILDExtensionConfiguration;
	private lens: FlagCodeLensProvider;
	private flagNodes: Array<IFlagTree> | null;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagMap: Map<string, FlagList | FlagNodeList> = new Map();
	constructor(ldConfig: ILDExtensionConfiguration, lens: FlagCodeLensProvider) {
		this.ldConfig = ldConfig;
		this.lens = lens;
		this.setFlagsInDocument();
		this.flagReadyListener();
		this.docListener();

		authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id === 'launchdarkly') {
				const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
				if (session === undefined) {
					this.flagNodes = null;
					await this.refresh();
				}
			}
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	docListener = () => {
		workspace.onDidChangeTextDocument(async (event) => {
			if (event?.document === window?.activeTextEditor?.document) {
				await this.debouncedFlags();
			}
		});
	};

	private debouncedFlags = debounce(
		async () => {
			await this.setFlagsInDocument();
		},
		200,
		//{ leading: true, trailing: true },
	);

	public setFlagsInDocument = async (): Promise<void> => {
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
			flagMeta = await this.ldConfig.getFlagStore()?.allFlagsMetadata();
		} catch (err) {
			//nothing
		}
		logDebugMessage(`Flags in file: ${JSON.stringify(flagsFound)}`);
		if (flagsFound.length > 0) {
			const releasedFlags = this.ldConfig.getReleaseView()?.releasedFlags;
			for await (const flag of flagsFound) {
				const codelensFlag = flag as FlagList;
				if (codelensFlag.flag) {
					await this.parseFlags(codelensFlag, flagMeta, releasedFlags?.has(codelensFlag.flag));
				}
			}
		}

		this.refresh();
		return;
	};

	parseFlags = async (codelensFlag: FlagList, flagMeta: Dictionary<FeatureFlag>, releaseFlag: boolean) => {
		const testElement = this.flagMap.has(codelensFlag.flag);

		if (testElement) {
			const getElement = this.flagMap.get(codelensFlag.flag);
			for (const range of getElement.list) {
				if (range.start.line === codelensFlag.range.start.line) {
					logDebugMessage(`Flag: ${codelensFlag.flag} range matches`);
					return;
				}
			}
			getElement.list.push(codelensFlag.range);
			logDebugMessage(`Flag: ${codelensFlag.flag} range added`);
			this.flagMap.set(codelensFlag.flag, getElement);
		} else {
			let newElement;
			if (typeof flagMeta !== 'undefined') {
				const flagSdkData = await this.ldConfig.getFlagStore().getFlagConfig(codelensFlag.flag);
				newElement = (await flagToValues(
					flagMeta[codelensFlag.flag],
					flagSdkData,
					this.ldConfig,
					undefined,
					releaseFlag,
				)) as FlagNodeList;
				if (newElement === undefined) {
					return;
				}
				newElement.list = [codelensFlag.range];
				this.flagNodes.push(newElement);
			} else {
				const highlightLabel: TreeItemLabel = {
					label: codelensFlag.flag,
					highlights: [
						[0, 5],
						[9, 12],
					],
				};
				const label = releaseFlag ? highlightLabel : codelensFlag.flag;
				newElement = new FlagItem(
					label,
					TreeItemCollapsibleState.Collapsed,
					codelensFlag.flag,
					[codelensFlag.range],
					null,
					'FlagItem',
				);
			}
			logDebugMessage(`Setting Flag: ${JSON.stringify(codelensFlag)}`);
			this.flagMap.set(codelensFlag.flag, newElement);
		}
	};

	async reload(e?: ConfigurationChangeEvent | undefined): Promise<void> {
		if (e && this.ldConfig.getConfig()?.streamingConfigReloadCheck(e)) {
			return;
		}
		await this.debouncedReload();
	}

	async getTreeItem(element: TreeItem): Promise<TreeItem> {
		// if (element.label == 'No Flags Found') {
		// 	return element;
		// }

		return element;
	}

	async getChildren(element?: FlagNode): Promise<TreeItem[]> {
		if (await this.ldConfig.getConfig()?.isConfigured()) {
			const items: TreeItem[] = [];
			if (typeof element !== 'undefined' && element.flagKey) {
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
					command: CMD_LD_ENABLE_LENS,
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

	private async flagReadyListener() {
		if (await this.ldConfig.getConfig()?.isConfigured()) {
			this.ldConfig.getFlagStore()?.ready?.event(async () => {
				try {
					this.flagUpdateListener();
				} catch (err) {
					console.error('Failed to update LaunchDarkly flag tree view:', err);
				}
			});
		}
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.ldConfig.getFlagStore()?.on('update', async (keys: string) => {
			try {
				const flagKeys = Object.values(keys);
				flagKeys.map((key) => {
					logDebugMessage(`Flags in File: Flag update detected for ${key}`);
					this.ldConfig
						.getFlagStore()
						?.getFeatureFlag(key)
						.then((updatedFlag) => {
							const existingFlag = this.flagMap.get(key);
							if (typeof existingFlag !== 'undefined') {
								logDebugMessage(`Flags in file: Flag found, updating node`);
								flagToValues(updatedFlag.flag, updatedFlag.config, this.ldConfig).then((newFlagValue) => {
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
	constructor(range: Range, flag: string, name: string, list?: Array<Range>, command?: Command | undefined) {
		super(range, flag, command);
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
		public readonly label: string | TreeItemLabel,
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

export type FlagNodeList = {
	tooltip: string;
	label: string;
	collapsibleState: TreeItemCollapsibleState;
	flagKey: string;
	uri: string;
	range?: Range;
	contextValue?: string;
	list?: Array<Range>;
	children?: FlagNode[];
	flagVersion?: number;
	enabled?: boolean;
	aliases?: string[];
};
