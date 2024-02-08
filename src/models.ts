import { LDContext, LDEvaluationDetail, LDFeatureStoreKindData } from '@launchdarkly/node-server-sdk';
import { ExecOptions } from 'child_process';
import { ClientSideAvailability, RepositoryRep } from 'launchdarkly-api-typescript';
import { Dictionary } from 'lodash';
import {
	AuthenticationSession,
	ConfigurationChangeEvent,
	EventEmitter,
	ExtensionContext,
	MarkdownString,
	StatusBarItem,
	TreeDataProvider,
	TreeItem,
	TreeView,
	WorkspaceFolder,
} from 'vscode';

export class Resource {
	name: string;
	key: string;
	tags: Array<string>;
	_version: number;
}

export class Instruction {
	kind: string;
	contextKind?: string;
	values?: string[];
	variationId?: string;
	clauses?: Clause[];
}

export class InstructionWithFlag {
	flagKey: string;
	instruction: InstructionPatch;
}

export class InstructionPatch {
	environmentKey: string;
	instructions: Instruction[];
}

export class Project extends Resource {
	environments: Array<Environment>;
}

export class EnvironmentAPI {
	items: Array<Environment>;
}
export class ProjectAPI {
	environments: EnvironmentAPI;
}
// export class Environment extends Resource {
// 	apiKey: string;
// 	version: number;
// 	_site: { href: string };
// }

export class PubNub {
	channel: string;
	cipherKey: string;
}
export class Environment {
	links?: Links;
	id?: Id;
	/**
	 * The key for the environment.
	 */
	key: string;
	/**
	 * The name of the environment.
	 */
	name: string;
	/**
	 * The SDK key for backend LaunchDarkly SDKs.
	 */
	apiKey?: string;
	/**
	 * The SDK key for mobile LaunchDarkly SDKs.
	 */
	mobileKey?: string;
	/**
	 * The swatch color for the environment.
	 */
	color?: string;
	/**
	 * The default TTL.
	 */
	defaultTtl?: number;
	/**
	 * Determines if this environment is in safe mode.
	 */
	secureMode?: boolean;
	/**
	 * Set to true to send detailed event information for new flags.
	 */
	defaultTrackEvents?: boolean;
	/**
	 * An array of tags for this environment.
	 */
	tags: Array<string>;
	/**
	 * Determines if this environment requires comments for flag and segment changes.
	 */
	requireComments?: boolean;
	/**
	 * Determines if this environment requires confirmation for flag and segment changes.
	 */
	confirmChanges?: boolean;
	_pubnub: PubNub;
	_version: number;

	static discriminator: string | undefined = undefined;

	static attributeTypeMap: Array<{ name: string; baseName: string; type: string }> = [
		{
			name: 'links',
			baseName: '_links',
			type: 'Links',
		},
		{
			name: 'id',
			baseName: '_id',
			type: 'Id',
		},
		{
			name: 'key',
			baseName: 'key',
			type: 'string',
		},
		{
			name: 'name',
			baseName: 'name',
			type: 'string',
		},
		{
			name: 'apiKey',
			baseName: 'apiKey',
			type: 'string',
		},
		{
			name: 'mobileKey',
			baseName: 'mobileKey',
			type: 'string',
		},
		{
			name: 'color',
			baseName: 'color',
			type: 'string',
		},
		{
			name: 'defaultTtl',
			baseName: 'defaultTtl',
			type: 'number',
		},
		{
			name: 'secureMode',
			baseName: 'secureMode',
			type: 'boolean',
		},
		{
			name: 'defaultTrackEvents',
			baseName: 'defaultTrackEvents',
			type: 'boolean',
		},
		{
			name: 'tags',
			baseName: 'tags',
			type: 'Array<string>',
		},
		{
			name: 'requireComments',
			baseName: 'requireComments',
			type: 'boolean',
		},
		{
			name: 'confirmChanges',
			baseName: 'confirmChanges',
			type: 'boolean',
		},
	];

	static getAttributeTypeMap(): Array<{ name: string; baseName: string; type: string }> {
		return Environment.attributeTypeMap;
	}
}

export class Flag extends Resource {
	environments: Map<string, Environment>;

	constructor(init?: Partial<Flag>) {
		super();
		Object.assign(this, init);
	}

	environmentVersion(env: string): number {
		if (!this.environments[env]) {
			return -1;
		}
		return this._version + this.environments[env].version;
	}
}

/* eslint-disable  @typescript-eslint/no-explicit-any */
export class FlagConfiguration {
	key: string;
	variations: Array<any>;
	offVariation: number | undefined;
	fallthrough: Fallthrough;
	prerequisites: any;
	targets: Array<Target>;
	rules: Array<any>;
	on: boolean;
	version: number;
}
/* eslint-enable  @typescript-eslint/no-explicit-any */

export class FlagWithConfiguration {
	flag: FeatureFlag;
	config: FlagConfiguration;
}

export class Variation {
	_id?: string;
	name?: string;
	description?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	value: any;
}

export class CustomProperty {
	/**
	 * The name of the property.
	 */
	name: string;
	/**
	 * Values for this property.
	 */
	value?: Array<string>;
}

export class Target {
	values?: Array<string>;
	variation?: number;
	contextKind?: string;
}

export class Rollout {
	bucketBy?: string;
	variations?: Array<WeightedVariation>;
}

export class WeightedVariation {
	variation?: number;
	weight?: number;
}

export class Clause {
	attribute?: string;
	op?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Array<any>;
	negate?: boolean;
	contextKind?: string;
	_key?: string;
}
export class Rule {
	_id?: string;
	description: string;
	variation?: number;
	trackEvents?: boolean;
	rollout?: Rollout;
	clauses?: Array<Clause>;
}

export class Fallthrough {
	variation?: number | undefined;
	rollout?: Rollout | undefined;
}

export class Prerequisite {
	key?: string;
	variation?: number;
}
export class FeatureFlagConfig {
	on?: boolean;
	archived?: boolean;
	salt?: string;
	sel?: string;
	lastModified?: number;
	version?: number;
	targets?: Array<Target>;
	rules?: Array<Rule>;
	fallthrough?: Fallthrough;
	offVariation?: number;
	prerequisites?: Array<Prerequisite>;
	/**
	 * Set to true to send detailed event information for this flag.
	 */
	trackEvents?: boolean;
	/**
	 * Set to true to send detailed event information when targeting is enabled but no individual targeting rule is matched.
	 */
	trackEventsFallthrough?: boolean;
	_site: Link;
}

export class Link {
	href?: string;
	type?: string;
}

export class Links {
	self?: Link;
	next?: Link;
}

export class Id {
	static discriminator: string | undefined = undefined;

	static attributeTypeMap: Array<{ name: string; baseName: string; type: string }> = [];

	static getAttributeTypeMap(): Array<{ name: string; baseName: string; type: string }> {
		return Id.attributeTypeMap;
	}
}

export class Role {
	static discriminator: string | undefined = undefined;

	static attributeTypeMap: Array<{ name: string; baseName: string; type: string }> = [];

	static getAttributeTypeMap(): Array<{ name: string; baseName: string; type: string }> {
		return Role.attributeTypeMap;
	}
}

export class Team {
	customRoleKeys: string[];
	key: string;
	name: string;
}
export class Member {
	links?: Links;
	id?: Id;
	role?: Role;
	email?: string;
	firstName?: string;
	lastName?: string;
	pendingInvite?: boolean;
	isBeta?: boolean;
	customRoles?: string[];
	teams: Team[];
}

export class Defaults {
	/**
	 * The index of the variation to be served when a flags targeting is on (default variation).
	 */
	onVariation: number;
	/**
	 * The index of the variation to be served when a flag is off.
	 */
	offVariation: number;

	static discriminator: string | undefined = undefined;

	static attributeTypeMap: Array<{ name: string; baseName: string; type: string }> = [
		{
			name: 'onVariation',
			baseName: 'onVariation',
			type: 'number',
		},
		{
			name: 'offVariation',
			baseName: 'offVariation',
			type: 'number',
		},
	];

	static getAttributeTypeMap(): Array<{ name: string; baseName: string; type: string }> {
		return Defaults.attributeTypeMap;
	}
}

export class FeatureFlag {
	constructor(init?: Partial<FeatureFlag>) {
		Object.assign(this, init);
	}

	key?: string;
	/**
	 * Name of the feature flag.
	 */
	name?: string;
	/**
	 * Description of the feature flag.
	 */
	description?: string;
	/**
	 * Whether the feature flag is a boolean flag or multivariate.
	 */
	kind?: string;
	/**
	 * A unix epoch time in milliseconds specifying the creation time of this flag.
	 */
	creationDate?: number;
	includeInSnippet?: boolean;
	/**
	 * Whether or not this flag is temporary.
	 */
	temporary?: boolean;
	/**
	 * The ID of the member that should maintain this flag.
	 */
	maintainerId?: string;
	/**
	 * An array of tags for this feature flag.
	 */
	tags?: Array<string>;
	/**
	 * The variations for this feature flag.
	 */
	variations?: Array<Variation>;
	/**
	 * An array goals from all environments associated with this feature flag
	 */
	goalIds?: Array<string>;
	_version?: number;
	/**
	 * A mapping of keys to CustomProperty entries.
	 */
	customProperties?: { [key: string]: CustomProperty };
	links?: Links;
	maintainer?: Member;
	environments?: { [key: string]: FeatureFlagConfig };
	/**
	 * A unix epoch time in milliseconds specifying the archived time of this flag.
	 */
	archivedDate?: number;
	/**
	 * Whether or not this flag is archived.
	 */
	archived?: boolean;
	defaults?: Defaults;
	/**
	 * Used by plugin to make sure number of variations has not changed
	 */
	variationLength?: number;
	rules?: Rule[];
	clientSideAvailability: ClientSideAvailability;
}

export class PatchOperation {
	op: string;
	path: string;
	value?: unknown;
}
export class PatchComment {
	comment?: string;
	patch?: Array<PatchOperation>;
}

export class Metric {
	key: string;
	name: string;
	description: string;
	kind: string;
	_attachedFlagCount: number;
	links?: Links;
	_site: Link;
	tags?: Array<string>;
	creationDate?: number;
	lastModified?: number;
	isNumeric: boolean;
	eventKey: string;
}

export interface NewFlag {
	name: string;
	key: string;
	description: string;
	tags: string[];
	kind: string;
	clientSideAvailability: {
		usingEnvironmentId: boolean;
		usingMobileKey: boolean;
	};
	temporary: boolean;
}

export class Branch {
	name: string;
	headSha: string;
	updateSequenceId: number | null;
	syncTime: number;
	references: ReferenceFile[];
	commitTime: number | null;
}

export class ReferenceFile {
	path: string;
	hint: string;
	hunks: Hunk[];
}

export class HunkWithFileId {
	fileId: string;
	path: string;
	hunk: Hunk;
}

export class Hunk {
	projKey: string;
	flagKey: string;
	startingLineNumber: number;
	lines: string;
	aliases: string[];
}

export class FlagLink {
	_links: { [key: string]: { href: string; type: string } };
	_key: string;
	_integrationKey: string;
	_id: string;
	_deepLink: string;
	_timestamp: { milliseconds: number; seconds: number; rfc3339: string; simple: string };
	_metadata: { [key: string]: string };
	_createdAt: number;
	_member: { _links: { self: { href: string; type: string } }; _id: string; firstName: string; lastName: string };
}

export class ReleasePipeline {
	name: string;
	key: string;
	description: string;
	tags: string[];
	phases: ReleasePhase[];
}

export class ReleasePhase {
	flagKey: string;
	name: string;
	id: string;
	audiences: Audience[];
	_completedAt?: number;
}

export class Audience {
	name: string;
	environments: Environment[];
}
export interface MemberTeamSummaryRep {
	/**
	 * A list of keys of the custom roles this team has access to
	 * @type {Array<string>}
	 * @memberof MemberTeamSummaryRep
	 */
	customRoleKeys: Array<string>;
	/**
	 * The team key
	 * @type {string}
	 * @memberof MemberTeamSummaryRep
	 */
	key: string;
	/**
	 *
	 * @type {{ [key: string]: Link; }}
	 * @memberof MemberTeamSummaryRep
	 */
	_links?: { [key: string]: Link };
	/**
	 * The team name
	 * @type {string}
	 * @memberof MemberTeamSummaryRep
	 */
	name: string;
}

export interface FlagStoreInterface {
	storeUpdates: EventEmitter<boolean | null>;
	// We fire a storeReady event because this will always exist compared to 'ready' listener on LDClient
	// which may be reinitialized
	storeReady: EventEmitter<boolean | null>;
	ready: EventEmitter<boolean | null>;
	reload(): Promise<void>;
	start(): Promise<void>;
	on(event: string, cb: (keys: string) => void): void;
	removeAllListeners(): Promise<void>;
	stop(): Promise<void>;
	getFeatureFlag(flag: string, fullFlag?: boolean): Promise<FlagWithConfiguration>;
	forceFeatureFlagUpdate(flagKey: string): Promise<void>;
	allFlags(): Promise<FlagConfiguration[] | LDFeatureStoreKindData>;
	getFlagConfig(flag: string): Promise<FlagConfiguration>;
	getFlagMetadata(flag: string): Promise<FeatureFlag>;
	allFlagsMetadata(): Promise<Dictionary<FeatureFlag>>;
	listFlags(): Promise<Array<string>>;
	executeAndUpdateFlagStore(
		func: (
			projectKey: string,
			flagKey: string,
			value?: PatchComment | InstructionPatch,
		) => Promise<FeatureFlag | Error>,
		projectKey: string,
		flagKey: string,
		value?: PatchComment | InstructionPatch,
	): Promise<FeatureFlag>;
	allFlags(): Promise<FlagConfiguration[] | LDFeatureStoreKindData>;
	variationDetail(flag: string, context: LDContext): Promise<LDEvaluationDetail>;
	// Add other methods as needed...
}

export interface LaunchDarklyTreeViewProviderInterface
	extends TreeDataProvider<FlagTreeInterface | FlagTreeInterface[]> {
	flagNodes: Array<FlagTreeInterface> | null;
	start(): void;
	treeLoader(): void;
	registerCommands(): void;
	refresh(): void;
	stop(): void;
	// Add other methods as needed...
}

export interface FlagTreeInterface {
	children: unknown;
	command?: unknown;
	flagKey?: string;
	flagVersion?: number;
}

export interface LaunchDarklyAuthenticationSession extends AuthenticationSession {
	refreshToken: string;
	baseUri: string;
	fullUri: string;
	teams: Team[];
	apiToken?: string;
}

export interface IFlagAliases {
	aliasUpdates: EventEmitter<boolean | null>;
	codeRefsVersionCheck(): Promise<boolean>;
	setupStatusBar(): void;
	exec(command: string, options: ExecOptions): Promise<{ stdout: string; stderr: string }>;
	generateAndReadAliases(directory?: WorkspaceFolder): Promise<void>;
	getListOfMapKeys(): Array<string> | undefined;
	getMap(): Map<string, string> | undefined;
	getKeys(): Map<string, string> | undefined;
	start(): Promise<void>;
}

export interface ILDExtensionConfiguration {
	getAliases(): IFlagAliases | undefined;
	setAliases(aliases: IFlagAliases): void;
	getApi(): LaunchDarklyAPIInterface | undefined;
	setApi(api: LaunchDarklyAPIInterface): void;
	getConfig(): IConfiguration | undefined;
	setConfig(config: IConfiguration): void;
	getCtx(): ExtensionContext;
	setCtx(ctx: ExtensionContext): void;
	getFlagStore(): FlagStoreInterface | undefined;
	setFlagStore(flagStore: FlagStoreInterface): void;
	getFlagTreeProvider(): TreeView<FlagTreeInterface> | undefined;
	setFlagTreeProvider(flagTreeProvider: TreeView<FlagTreeInterface>): void;
	getFlagView(): LaunchDarklyTreeViewProviderInterface | undefined;
	setFlagView(flagView: LaunchDarklyTreeViewProviderInterface): void;
	getReleaseView(): ILaunchDarklyReleaseProvider | undefined;
	setReleaseView(releaseView: ILaunchDarklyReleaseProvider): void;
	getSession(): LaunchDarklyAuthenticationSession | undefined;
	setSession(session: LaunchDarklyAuthenticationSession): void;
	getStatusBar(): StatusBarItem | undefined;
	setStatusBar(statusBar: StatusBarItem): void;
}

export interface LaunchDarklyAPIInterface {
	getProjects(url?: string): Promise<Array<Project>>;
	getProject(projectKey: string, url?: string): Promise<ProjectAPI | undefined>;
	getEnvironments(url: string): Promise<Array<Environment>>;
	getEnvironment(projectKey: string, envKey: string): Promise<Environment>;
	getMetrics(projectKey: string): Promise<Array<Metric>>;
	getFeatureFlag(projectKey: string, flagKey: string, envKey?: string, fullFlag?: boolean): Promise<FeatureFlag>;
	getFlagCodeRefs(projectKey: string, repo: string, flag?: string): Promise<Array<RepositoryRep>>;
	getFlagLinks(projectKey: string, flag: string): Promise<Array<FlagLink>>;
	getReleasePipelines(projectKey: string): Promise<Array<ReleasePipeline>>;
	getReleases(projectKey: string, pipelineKey: string, pipelineId: string): Promise<Array<ReleasePhase>>;
	getCompletedReleases(projectKey: string, pipelineKey: string): Promise<Array<ReleasePhase>>;
	postFeatureFlag(projectKey: string, flag: NewFlag): Promise<FeatureFlag>;
	getFeatureFlags(projectKey: string, envKey?: string, url?: string): Promise<Array<FeatureFlag>>;
	patchFeatureFlag(projectKey: string, flagKey: string, value?: PatchComment): Promise<FeatureFlag | Error>;
	patchFeatureFlagOn(projectKey: string, flagKey: string, enabled: boolean): Promise<FeatureFlag | Error>;
	patchFeatureFlagSem(projectKey: string, flagKey: string, value?: InstructionPatch): Promise<FeatureFlag | Error>;
}

export interface IConfiguration {
	project: string;
	env: string;
	codeRefsPath?: string;
	codeRefsRefreshRate: number;
	enableAliases: boolean;
	enableFlagExplorer: boolean;
	refreshRate: number;
	accessToken: string;
	enableHover: boolean;
	enableAutocomplete: boolean;
	enableMetricExplorer: boolean;
	enableCodeLens: boolean;
	baseUri: string;
	streamUri?: string;
	isConfigured(): Promise<boolean>;
	clearLocalConfig(): Promise<void>;
	clearGlobalConfig(): Promise<void>;
	copyWorkspaceToGlobal(): Promise<void>;
	setGlobalDefault(): Promise<void>;
	getState(key: string): Promise<string | unknown>;
	reload(): Promise<void>;
	streamingConfigReloadCheck(e: ConfigurationChangeEvent): boolean;
	update(key: string, value: string | boolean, global: boolean): Promise<void>;
	validate(): Promise<string>;
	validateRefreshInterval(interval: number): boolean;
}

export interface ILaunchDarklyReleaseProvider extends TreeDataProvider<TreeItem> {
	config: ILDExtensionConfiguration;
	releasedFlags: Set<string>;
	refresh(): void;
	start(): void;
	reload(): void;
	periodicRefresh(): void;
	getReleases(): Promise<IReleasePhaseParentNode[]>;
}

export interface IReleasePhaseParentNode extends TreeItem {
	children: IReleaseFlagNode[] | undefined;
	tooltip?: string | MarkdownString;
}

export interface IReleaseFlagNode {
	flagKey?: string;
	contextValue?: string;
	tooltip?: string | MarkdownString;
}
