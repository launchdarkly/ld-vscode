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
} from 'vscode';
import { Configuration } from '../configuration';
import { FeatureFlag, FlagConfiguration } from '../models';
import { FlagCodeLens, FlagCodeLensProvider } from './flagLens';

export class LaunchDarklyFlagListProvider implements TreeDataProvider<TreeItem> {
	private config: Configuration;
	private lens: FlagCodeLensProvider;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagsInFile: Array<FlagList> = [];
	private flagMap: Map<string, FlagList> = new Map();
	constructor(config: Configuration, lens: FlagCodeLensProvider) {
		this.config = config;
		this.lens = lens;
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
			this.flagMap.forEach((flag) => {
				items.push(
					new FlagNode(
						`${flag.flag.name ? flag.flag.name : flag.env.key}`,
						TreeItemCollapsibleState.Collapsed,
						flag.env.key,
						null,
						'flag',
					),
				);
			});
			return Promise.resolve(items);
		} else {
			return Promise.resolve([new TreeItem('No Flags found in file')]);
		}
	}

	public setFlagsinDocument = async (): Promise<void> => {
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
		try {
			flagsFound = await this.lens.ldCodeLens(editor.document);
		} catch (err) {
			// Try maximum of 2 times for lens to resolve
			flagsFound = await this.lens.ldCodeLens(editor.document);
		}
		if (typeof flagsFound === 'undefined') {
			this.refresh();
			return;
		}
		flagsFound.map((flag) => {
			const codelensFlag = flag as FlagCodeLens;
			if (codelensFlag?.env?.key) {
				const getElement = this.flagMap.get(codelensFlag.env.key);
				if (getElement) {
					getElement.list.push(codelensFlag.range);
				} else {
					const newElement = new FlagList(
						codelensFlag.range,
						codelensFlag.flag,
						codelensFlag.env,
						codelensFlag.config,
						[codelensFlag.range],
					);
					this.flagMap.set(codelensFlag.env.key, newElement);
				}
			}
		});
		this.refresh();
	};
}

class FlagList extends FlagCodeLens {
	public list?: Array<Range>;
	public readonly flag: FeatureFlag;
	public readonly env: FlagConfiguration;
	public config: Configuration;
	constructor(
		range: Range,
		flag: FeatureFlag,
		env: FlagConfiguration,
		config: Configuration,
		list?: Array<Range>,
		command?: Command | undefined,
	) {
		super(range, flag, env, config, command);
		this.flag = flag;
		this.env = env;
		this.config = config;
		this.list = list;
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
