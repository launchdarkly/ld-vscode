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
} from 'vscode';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import { FlagCodeLensProvider, SimpleCodeLens } from './flagLens';

export class LaunchDarklyFlagListProvider implements TreeDataProvider<TreeItem> {
	private config: Configuration;
	private lens: FlagCodeLensProvider;
	private flagStore: FlagStore;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagMap: Map<string, FlagList> = new Map();
	constructor(config: Configuration, lens: FlagCodeLensProvider, flagStore: FlagStore) {
		this.config = config;
		this.lens = lens;
		this.flagStore = flagStore;
		this.setFlagsinDocument();
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
				const newElement = new FlagNode(`Line: ${entry.end.line + 1}`, null, element.flagKey, entry, 'child');
				items.push(newElement);
			});
			return Promise.resolve(items);
		} else if (this.flagMap?.size > 0) {
			const CodeLensCmd = new TreeItem('Toggle CodeLens');
			CodeLensCmd.command = {
				title: 'Command',
				command: 'launchdarkly.enableCodeLens',
			};

			items.push(CodeLensCmd);
			this.flagMap.forEach((flag) => {
				items.push(new FlagNode(`${flag.flag}`, TreeItemCollapsibleState.Collapsed, flag.name, null, 'flag'));
			});
			return Promise.resolve(items);
		} else {
			return Promise.resolve([new TreeItem('No Flags found in file')]);
		}
	}

	public setFlagsinDocument = async (): Promise<void> => {
		this.refresh();
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
			console.log('error');
			flagsFound = await this.lens.ldCodeLens(editor.document, canceltoken.token, false);
		}
		console.log(flagsFound);
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

		flagsFound.map((flag) => {
			const codelensFlag = flag as FlagList;
			if (codelensFlag.flag) {
				const getElement = this.flagMap.get(codelensFlag.flag);
				if (getElement) {
					getElement.list.push(codelensFlag.range);
				} else {
					let name;
					if (typeof flagMeta !== 'undefined') {
						name = flagMeta[codelensFlag.flag].name;
					} else {
						name = codelensFlag.flag;
					}
					const newElement = new FlagList(codelensFlag.range, name, codelensFlag.flag, this.config, [
						codelensFlag.range,
					]);
					this.flagMap.set(codelensFlag.flag, newElement);
				}
			}
		});

		this.refresh();
		return;
	};
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

export class FlagNode extends TreeItem {
	flagKey: string;
	range?: Range;
	contextValue?: string;
	constructor(
		public readonly label: string,
		public collapsibleState: TreeItemCollapsibleState,
		flagKey: string,
		range?: Range,
		contextValue?: string,
	) {
		super(label, collapsibleState);
		this.flagKey = flagKey;
		this.range = range;
		this.contextValue = contextValue;
	}
}
