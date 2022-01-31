import { debounce } from 'lodash';
import {
	ConfigurationChangeEvent,
	Event,
	EventEmitter,
	TreeItem,
	QuickPickItem,
	TreeDataProvider,
	TreeItemCollapsibleState,
	Command,
	window,
	commands,
} from 'vscode';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import checkExistingCommand from '../utils';

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

	async start(): Promise<void> {
		const compareFlagsCmd = 'launchdarkly.openCompareFlag';
		if (await checkExistingCommand(compareFlagsCmd)) {
			return;
		}
		commands.registerCommand(compareFlagsCmd, async () => {
			let values: QuickPickItem[] = [{ label: 'No flags found', description: '' }];
			if (typeof this.flagStore !== 'undefined') {
				const flags = await this.flagStore.allFlagsMetadata();
				const flagKeys = Object.keys(flags);
				if (flagKeys.length > 0) {
					const options = [];
					flagKeys.map((item) => {
						options.push({ label: flags[item].key, description: flags[item].name ? flags[item].name : '' });
					});
					values = options;
				}
			}
			const quickPick = window.createQuickPick();
			quickPick.items = values;
			quickPick.title = 'Select Flag for Overview';
			quickPick.placeholder = 'placeholder';
			quickPick.onDidAccept(() => {
				const linkUrl = `${this.config.baseUri}/${this.config.project}/${this.config.env}/features/${quickPick.selectedItems[0].label}/compare-flag`;
				commands.executeCommand('launchdarkly.openBrowser', linkUrl);
				quickPick.dispose();
			});
			quickPick.show();
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

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		items.push(new LinkNode(`Open Documentation`, NON_COLLAPSED, `https://docs.launchdarkly.com`));
		items.push(new LinkNode(`Open API Documentation`, NON_COLLAPSED, `https://apidocs.launchdarkly.com`));

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
