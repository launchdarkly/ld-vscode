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
import checkExistingCommand from '../utils/common';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';

const NON_COLLAPSED = TreeItemCollapsibleState.None;

export class QuickLinksListProvider implements TreeDataProvider<TreeItem> {
	private config: LDExtensionConfiguration;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null | void> = new EventEmitter<TreeItem | null | void>();
	readonly onDidChangeTreeData: Event<TreeItem | null | void> = this._onDidChangeTreeData.event;

	constructor(config: LDExtensionConfiguration) {
		this.config = config;
		if (this.config.getSession() !== undefined) {
			this.start();
		}
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
			if (this.config.getFlagStore() !== null) {
				const flags = await this.config.getFlagStore().allFlagsMetadata();
				const flagKeys = Object.keys(flags);
				if (flagKeys?.length > 0) {
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
				const linkUrl = `${this.config.getSession().fullUri}/${this.config.getConfig().project}/${
					this.config.getConfig().env
				}/features/${quickPick.selectedItems[0].label}/compare-flag`;
				commands.executeCommand('launchdarkly.openBrowser', linkUrl);
				quickPick.dispose();
			});
			quickPick.show();
		});
	}
	async reload(e?: ConfigurationChangeEvent | undefined): Promise<void> {
		if (e && this.config.getConfig().streamingConfigReloadCheck(e)) {
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
		if (this.config.getSession() === undefined) {
			return [];
		}
		const baseUrl = `${this.config.getSession().fullUri}/${this.config.getConfig().project}/${
			this.config.getConfig().env
		}`;
		const items = [];
		items.push(
			new LinkNode(`Create Boolean Feature Flag`, NON_COLLAPSED, '', {
				title: 'Create Boolean Feature Flag',
				command: 'launchdarkly.createFlag',
			}),
		);
		items.push(new LinkNode(`Create Non-boolean Feature Flag`, NON_COLLAPSED, addUtm(`${baseUrl}/features/create`)));
		items.push(new LinkNode(`Feature Flags`, NON_COLLAPSED, addUtm(`${baseUrl}/features`)));
		items.push(new LinkNode(`Segments`, NON_COLLAPSED, addUtm(`${baseUrl}/segments`)));
		items.push(new LinkNode(`Contexts`, NON_COLLAPSED, addUtm(`${baseUrl}/contexts`)));
		items.push(new LinkNode(`Live Events`, NON_COLLAPSED, addUtm(`${baseUrl}/debugger`)));
		items.push(new LinkNode(`Experiments`, NON_COLLAPSED, addUtm(`${baseUrl}/experiments`)));
		items.push(new LinkNode(`Audit Log`, NON_COLLAPSED, addUtm(`${baseUrl}/audit`)));
		items.push(new LinkNode(`Flag Comparison`, NON_COLLAPSED, addUtm(`${baseUrl}/features/compare`)));
		items.push(
			new LinkNode(`Flag Environment Overview`, NON_COLLAPSED, '', {
				title: 'Open In Browser',
				command: 'launchdarkly.openCompareFlag',
			}),
		);
		items.push(new LinkNode(`Documentation`, NON_COLLAPSED, addUtm(`https://docs.launchdarkly.com`)));

		return Promise.resolve(items);
	}
}

function addUtm(url: string) {
	return `${url}?utm_source=vscode`;
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
