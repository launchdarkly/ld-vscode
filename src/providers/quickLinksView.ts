import { debounce, isLength } from 'lodash';
import {
	ConfigurationChangeEvent,
	Event,
	EventEmitter,
	TreeItem,
	TreeDataProvider,
	TreeItemCollapsibleState,
	Command,
	window,
	commands,
} from 'vscode';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';

const NON_COLLAPSED = TreeItemCollapsibleState.None;

export class QuickLinksListProvider implements TreeDataProvider<TreeItem> {
	private config: Configuration;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;
	private flagStore?: FlagStore;

	constructor(config: Configuration, flagStore?: FlagStore) {
		this.config = config;
		this.flagStore = flagStore;
		this.start();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	start(): void {
		commands.registerCommand('launchdarkly.openCompareFlag', async () => {
			let flags = ['No flags found'];
			if (typeof this.flagStore !== 'undefined') {
				const flagKeys = Object.keys(this.flagStore.allFlagsMetadata());
				if (flagKeys.length > 0) {
					flags = flagKeys;
				}
			}
			console.log(flags);
			await window.showQuickPick(flags, {
				onDidSelectItem: (item) => window.showInformationMessage(`Focus ${item}`),
			});
		});
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

	async getChildren(element?: LinkNode): Promise<LinkNode[]> {
		const baseUrl = `${this.config.baseUri}/${this.config.project}/${this.config.env}`;
		const items = [];
		items.push(new LinkNode(`Open Flags`, NON_COLLAPSED, `${baseUrl}/features`));
		items.push(new LinkNode(`Open Segments`, NON_COLLAPSED, `${baseUrl}/segments`));
		items.push(new LinkNode(`Open Users`, NON_COLLAPSED, `${baseUrl}/users`));
		items.push(new LinkNode(`Open Debugger`, NON_COLLAPSED, `${baseUrl}/debugger`));
		items.push(new LinkNode(`Open Experiments`, NON_COLLAPSED, `${baseUrl}/experiments`));
		items.push(new LinkNode(`Open Audit Log`, NON_COLLAPSED, `${baseUrl}/audit`));
		items.push(new LinkNode(`Open Flag Comparison`, NON_COLLAPSED, `${baseUrl}/features/compare`));
		items.push(
			new LinkNode(`Open Flag Environment Overview`, NON_COLLAPSED, '', {
				title: 'Open In Browser',
				command: 'launchdarkly.openCompareFlag',
			}),
		);

		return Promise.resolve(items);
	}
}

export class LinkNode extends TreeItem {
	environment: string;
	uri: string;
	command?: Command;
	constructor(
		public readonly label: string,
		public collapsibleState: TreeItemCollapsibleState,
		uri: string,
		command?: Command,
	) {
		super(label, collapsibleState);
		this.uri = uri;
		this.command = command
			? command
			: {
					title: 'Open In Browser',
					command: 'launchdarkly.openBrowser',
					arguments: [this.uri],
			  };
	}
}
