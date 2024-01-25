import { TreeDataProvider, TreeItem, Event, EventEmitter, TreeItemCollapsibleState, MarkdownString } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { FeatureFlag, ReleasePhase, ReleasePipeline } from '../models';
import * as url from 'url';
//import { setTimeout } from 'timers/promises';

export class LaunchDarklyReleaseProvider implements TreeDataProvider<TreeItem> {
	private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
	readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;
	readonly config: LDExtensionConfiguration;
	private nodes: ReleasePhaseParentNode[] | TreeItem[] = [];
	private updateTimer: NodeJS.Timeout | undefined;
	constructor(config: LDExtensionConfiguration) {
		this.config = config;
		this.start();
		this.periodicRefresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}

	start(): void {
		this.nodes = [new TreeItem('Loading Releases...', TreeItemCollapsibleState.None)];
		this.getReleases().then((releases) => {
			this.nodes = releases;
			this.refresh();
		});
	}

	reload(): void {
		this.refresh();
	}

	periodicRefresh(): void {
		setTimeout(
			async () => {
				this.getReleases()
					.then((releases) => {
						this.nodes = releases;
						this.refresh();
						this.periodicRefresh();
					})
					.catch((err) => {
						console.error(err);
						this.periodicRefresh();
					});
			},
			60 * 60 * 1000,
		);
	}

	getTreeItem(element: ReleasePhaseParentNode): TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (typeof element !== 'undefined') {
			const getElement = element as ReleasePhaseParentNode;
			if (getElement.children && getElement.children.length > 0) {
				return getElement.children as ReleaseFlagNode[];
			}
		}
		return this.nodes;
	}

	async getReleases(): Promise<ReleasePhaseParentNode[]> {
		const nodes = [];
		const releases = await this.config.getApi().getReleasePipelines(this.config.getConfig().project);
		for (const release of releases) {
			const releaseNode = new ReleasePhaseParentNode(
				release.name,
				TreeItemCollapsibleState.Collapsed,
				generateReleaseTooltip(release),
			);
			releaseNode.children = [];
			const phases = [];
			release.phases.forEach((phase) => {
				phases.push({ name: phase.name, id: phase.id, full: phase });
			});
			for (const phase of phases) {
				const flagsInPhase = [];
				const phaseNode = new ReleasePhaseParentNode(
					phase.name,
					TreeItemCollapsibleState.None,
					generatePhaseTooltip(phase.full),
				);
				const phaseData = await this.config
					.getApi()
					.getReleases(this.config.getConfig().project, release.key, phase.id);
				for (const flag of phaseData) {
					const flagData = await this.config.getApi().getFeatureFlag(this.config.getConfig().project, flag.flagKey);
					flagsInPhase.push(
						new ReleaseFlagNode(
							flagData.name,
							flag.flagKey,
							'releaseFlag',
							generateGlobalFlagHoverString(flagData, this.config),
						),
					);
					//const flagNode = new ReleaseFlagNode(flagData.name, flag.flagKey, 'releaseFlag', generateGlobalFlagHoverString(flagData, this.config));
					//flagNode.tooltip = ;
					//flagsInPhase.push(flagNode);
				}
				if (flagsInPhase.length > 0) {
					phaseNode.collapsibleState = TreeItemCollapsibleState.Collapsed;
				}
				phaseNode.children = flagsInPhase;
				releaseNode.children.push(phaseNode);
			}

			const completedPhase = await this.config
				.getApi()
				.getCompletedReleases(this.config.getConfig().project, release.key);
			if (completedPhase.length > 0) {
				const completedNode = new ReleasePhaseParentNode(
					'Released',
					TreeItemCollapsibleState.Collapsed,
					'Flags that have been fully released',
				);
				completedNode.children = [];
				for (const flag of completedPhase) {
					const flagData = await this.config.getApi().getFeatureFlag(this.config.getConfig().project, flag.flagKey);
					if (flagData === undefined) {
						continue;
					}
					const flagNode = new ReleaseFlagNode(flagData.name, flag.flagKey, 'releaseFlag');
					flagNode.tooltip = generateGlobalFlagHoverString(flagData, this.config, flag._completedAt);
					completedNode.children.push(flagNode);
				}
				releaseNode.children.push(completedNode);
			}
			nodes.push(releaseNode);
		}
		if (nodes.length === 0) {
			nodes.push(
				new TreeItem(
					`No Releases found for Project: ${this.config.getConfig().project}`,
					TreeItemCollapsibleState.None,
				),
			);
		}
		return nodes;
	}
}

class ReleasePhaseParentNode extends TreeItem {
	children: ReleaseFlagNode[] | undefined;
	tooltip?: string | MarkdownString;

	constructor(
		public readonly label: string,
		collapsibleState: TreeItemCollapsibleState,
		tooltip?: string | MarkdownString,
	) {
		super(label, collapsibleState);
		this.tooltip = tooltip;
	}
}

export class ReleaseFlagNode extends TreeItem {
	flagKey?: string;
	contextValue?: string;
	tooltip?: string | MarkdownString;

	constructor(
		public readonly label: string,
		flagKey?: string,
		contextValue?: string,
		tooltip?: string | MarkdownString,
	) {
		super(label);
		this.flagKey = flagKey;
		this.contextValue = contextValue;
		this.tooltip = tooltip;
	}
}

// Write a function that takes Release information and generates a markdown string
// This markdown string should be used as the tooltip for the ReleaseParentNode
// The markdown string should include the following:
// - Release Name
// - Release Description
// - Release URL
function generateReleaseTooltip(release: ReleasePipeline): MarkdownString {
	const tooltip = new MarkdownString();
	tooltip.appendMarkdown(`**Name:** ${release.name}\n\n`);
	tooltip.appendMarkdown(`**Description:** ${release.description}\n\n`);
	return tooltip;
}

function generateGlobalFlagHoverString(
	flag: FeatureFlag,
	config: LDExtensionConfiguration,
	completedDate?: number,
): MarkdownString {
	let env;
	try {
		env = Object.keys(flag.environments)[0];
	} catch (err) {
		console.error(err);
		return;
	}
	const flagUri = url.resolve(config.getSession().fullUri, flag.environments[env]._site.href);
	const hoverString = new MarkdownString(
		`${config.getConfig().project} / **[${flag.key}](${flagUri} "Open in LaunchDarkly")** \n\n`,
		true,
	);
	hoverString.isTrusted = true;

	hoverString.appendText('\n');
	hoverString.appendMarkdown(flag.description);
	hoverString.appendText('\n');
	if (completedDate) {
		hoverString.appendMarkdown(`Completed On: ${new Date(completedDate).toLocaleString()}\n\n`);
	}
	const clientSDK = flag.clientSideAvailability.usingEnvironmentId ? '$(browser)' : '';
	const mobileSDK = flag.clientSideAvailability.usingMobileKey ? '$(device-mobile)' : '';
	const sdkAvailability = `Client-side SDK availability: ${clientSDK}${clientSDK && mobileSDK ? ' ' : ''}${mobileSDK}${
		!clientSDK && !mobileSDK ? '$(server)' : ''
	}\n\n`;
	hoverString.appendMarkdown(sdkAvailability);

	let varTypeIcon;
	const varType = flag.kind === 'multivariate' ? typeof flag.variations[0].value : flag.kind;
	switch (varType) {
		case 'boolean':
			varTypeIcon = '$(symbol-boolean)';
			break;
		case 'number':
			varTypeIcon = '$(symbol-number)';
			break;
		case 'object':
			varTypeIcon = '$(symbol-object)';
			break;
		case 'string':
			varTypeIcon = '$(symbol-key)';
			break;
		default:
			break;
	}

	hoverString.appendMarkdown(`**${varTypeIcon} Variations**`);
	flag.variations.map((variation) => {
		const varVal = `\`${truncate(JSON.stringify(variation.value), 30).trim()}\``;
		const varName = variation.name ? ` **${variation.name}**` : '';
		const varDescription = variation.description ? `: ${variation.description}` : '';
		hoverString.appendText('\n');
		hoverString.appendMarkdown(`* ${varVal}${varName}${varDescription}}`);
	});

	return hoverString;
}

// Write a function that takes Phase information and generates a markdown string
// This markdown string should be used as the tooltip for the ReleaseParentNode
// The markdown string should include the following:
// - Phase Name
// - Phase Audience that links to the audience
function generatePhaseTooltip(phase: ReleasePhase): MarkdownString {
	const tooltip = new MarkdownString();
	tooltip.appendMarkdown(`**Phase Name:** ${phase.name}\n\n`);
	tooltip.appendMarkdown(`**Phase Audience:**\n\n`);
	for (const audience of phase.audiences) {
		tooltip.appendMarkdown(`\t * ${audience.name}\n\n`);
	}
	return tooltip;
}

function truncate(str: string, n: number): string {
	return str.length > n ? str.substr(0, n - 1) + '\u2026' : str;
}
