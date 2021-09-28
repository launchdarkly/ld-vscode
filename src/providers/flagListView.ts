import { debounce } from 'lodash';
import {
	CodeLensProvider,
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
import { FlagCodeLens } from './flagLens';

export class LaunchDarklyFlagListProvider implements TreeDataProvider<TreeItem> {
	private config: Configuration;
	private lens: CodeLensProvider;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagsInFile: Array<FlagList> = [];
	private flagMap: Map<string, FlagList> = new Map();
	constructor(config: Configuration, lens: CodeLensProvider) {
		this.config = config;
		this.lens = lens;
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
			child.list.forEach(entry => {
				items.push(new TreeItem(`Line: ${entry.end.line}`));
			});
			return Promise.resolve(items);
		} else if (this.flagMap?.size > 0) {
			this.flagMap.forEach(flag => {
				items.push(
					new FlagNode(
						`${flag.flag.name ? flag.flag.name : flag.env.key}`,
						TreeItemCollapsibleState.Collapsed,
						flag.env.key,
					),
				);
			});
			return Promise.resolve(items);
		} else {
			return Promise.resolve([new TreeItem('No Flags found in file')]);
		}
	}

	public setFlagsinDocument = async (): Promise<void> => {
		const editor = window.activeTextEditor;
		const flagsFound = await this.lens.provideCodeLenses(editor.document, null);
		this.flagMap = new Map();
		flagsFound.map(flag => {
			const codelensFlag = flag as FlagCodeLens;
			const getElement = this.flagMap.get(codelensFlag.env.key);
			if (getElement) {
				getElement.list.push(codelensFlag.range);
			} else {
				const newElement = new FlagList(codelensFlag.range, codelensFlag.flag, codelensFlag.env, codelensFlag.config, [
					codelensFlag.range,
				]);
				this.flagMap.set(codelensFlag.env.key, newElement);
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
	constructor(public readonly label: string, public collapsibleState: TreeItemCollapsibleState, flagKey: string) {
		super(label, collapsibleState);
		this.flagKey = flagKey;
	}
}
