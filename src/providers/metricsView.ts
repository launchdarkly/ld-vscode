import * as vscode from 'vscode';
import { Metric } from '../models';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import * as path from 'path';
import * as url from 'url';
import { MarkdownString } from 'vscode';

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NON_COLLAPSED = vscode.TreeItemCollapsibleState.None;

export class LaunchDarklyMetricsTreeViewProvider implements vscode.TreeDataProvider<MetricValue> {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private flagStore: FlagStore;
	private metricValues: Array<MetricValue>;
	private ctx: vscode.ExtensionContext;
	private _onDidChangeTreeData: vscode.EventEmitter<MetricValue | null | void> = new vscode.EventEmitter<MetricValue | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MetricValue | null | void> = this._onDidChangeTreeData.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, ctx: vscode.ExtensionContext) {
		this.api = api;
		this.config = config;
		this.ctx = ctx;
		this.start();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	reload(): void {
		this.getMetrics();
		this.refresh();
	}

	getTreeItem(element: MetricValue): vscode.TreeItem {
		return element;
	}

	getChildren(element?: MetricValue): Thenable<MetricValue[]> {
		if (!this.metricValues) {
			return Promise.resolve([new MetricValue(this.ctx, 'No Metrics Found', new MarkdownString(), NON_COLLAPSED)]);
		}

		return Promise.resolve(element ? element.children : this.metricValues);
	}

	async getMetrics(): Promise<void> {
		const metrics = await this.api.getMetrics(this.config.project);
		const metricValues = [];
		metrics.map(metric => {
			if (metric.kind == 'custom') {
				metricValues.push(this.metricToValues(metric));
			}
		});
		this.metricValues = metricValues;
		this.refresh();
	}

	async start(): Promise<void> {
		this.ctx.subscriptions.push(
			vscode.commands.registerCommand('launchdarkly.refreshEntryMetric', () => this.refresh()),
			registerMetricTreeviewRefreshCommand(this),
		);
		this.getMetrics();
	}

	private metricFactory({
		label = '',
		tooltip = '',
		collapsed = NON_COLLAPSED,
		children = [],
		ctxValue = '',
		uri = '',
	}) {
		return metricValueFactory({
			ctx: this.ctx,
			label: label,
			tooltip: tooltip,
			collapsed: collapsed,
			children: children,
			ctxValue: ctxValue,
			uri: uri,
		});
	}

	private metricToValues(metric: Metric): MetricValue {
		const metricUri = this.config.baseUri + metric._site.href;
		const tooltip = generateMetricsHoverString(metric, this.config);
		const item = new MetricValue(this.ctx, metric.name, tooltip, NON_COLLAPSED, [], 'metricParentItem', metricUri);
		const child = item.children;

		if (metric.tags) {
			item.collapsibleState = COLLAPSED;
			const tags: Array<MetricValue> = [];
			metric.tags.map(tag => {
				tags.push(this.metricFactory({ label: tag, ctxValue: 'flagTagItem' }));
			});
			const childNode = new MetricValue(this.ctx, 'Tags', '', COLLAPSED, tags, 'tags');
			child.push(childNode);
		}

		if (metric._attachedFlagCount > 0) {
			this.metricFactory({ label: `Attached flags: ${metric._attachedFlagCount}`, ctxValue: 'metricAttach' });
		}

		return item;
	}
}

export function metricValueFactory({
	ctx = null,
	label = '',
	collapsed = NON_COLLAPSED,
	tooltip = '',
	children = [],
	ctxValue = '',
	uri = '',
	flagKey = '',
	flagParentName = '',
}) {
	return new MetricValue(ctx, label, tooltip, collapsed, children, ctxValue, uri, flagKey, flagParentName);
}

export class MetricValue extends vscode.TreeItem {
	children: MetricValue[] | undefined;
	contextValue?: string;
	uri?: string;
	flagKey?: string;
	flagParentName?: string;

	constructor(
		ctx: vscode.ExtensionContext,
		public readonly label: string,
		public readonly tooltip: string | MarkdownString,
		public collapsibleState: vscode.TreeItemCollapsibleState,
		children?: MetricValue[],
		contextValue?: string,
		uri?: string,
		flagKey?: string,
		flagParentName?: string,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.children = children;
		this.uri = uri;
		this.flagKey = flagKey;
		this.flagParentName = flagParentName;
		this.conditionalIcon(ctx, this.contextValue, this.label);
	}

	private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, label: string) {
		if (ctx) {
			this.setIcon(ctx, contextValue);
		}
	}

	private setIcon(ctx: vscode.ExtensionContext, fileName: string): vscode.ThemeIcon {
		return (this.iconPath = {
			id: null,
			light: ctx.asAbsolutePath(path.join('resources', 'light', fileName + '.svg')),
			dark: ctx.asAbsolutePath(path.join('resources', 'dark', fileName + '.svg')),
		});
	}
}

export function registerMetricTreeviewRefreshCommand(
	treeDataProvider: LaunchDarklyMetricsTreeViewProvider,
): vscode.Disposable {
	return vscode.commands.registerCommand('launchdarkly.treeviewMetricRefresh', (): void => {
		treeDataProvider.reload();
		vscode.commands.executeCommand(
			'setContext',
			'launchdarkly:enableMetricTreeview',
			this.config.enableMetricsExplorer,
		);
	});
}

function generateMetricsHoverString(metric: Metric, config: Configuration): MarkdownString {
	const metricUri = url.resolve(config.baseUri, metric._site.href);
	const hoverString = new MarkdownString(
		`${config.project} / **[${metric.key}](${metricUri} "Open in LaunchDarkly")** \n\n`,
		true,
	);
	hoverString.isTrusted = true;

	hoverString.appendText('\n');
	hoverString.appendMarkdown(metric.description);
	hoverString.appendText('\n');
	hoverString.appendMarkdown(`Kind: ${metric.kind}\n\n`);
	hoverString.appendMarkdown(`    `);
	if (metric.kind === 'custom') {
		if (metric.isNumeric) {
			hoverString.appendMarkdown(`Type: Numeric`);
		} else {
			hoverString.appendMarkdown(`Type: Conversion`);
		}
	}
	hoverString.appendText('\n');

	return hoverString;
}
