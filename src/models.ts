export class Resource {
	name: string;
	key: string;
	tags: Array<string>;
	_version: number;
}

export class Project extends Resource {
	environments: Array<Environment>;
}

// export class Environment extends Resource {
// 	apiKey: string;
// 	version: number;
// 	_site: { href: string };
// }
export class Environment {
	links?: Links;
	id?: Id;
	/**
	 * The key for the environment.
	 */
	key?: string;
	/**
	 * The name of the environment.
	 */
	name?: string;
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
	tags?: Array<string>;
	/**
	 * Determines if this environment requires comments for flag and segment changes.
	 */
	requireComments?: boolean;
	/**
	 * Determines if this environment requires confirmation for flag and segment changes.
	 */
	confirmChanges?: boolean;

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
	fallthrough: any;
	prerequisites: any;
	targets: any;
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
}
export class Rule {
	id?: string;
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

export class Member {
	links?: Links;
	id?: Id;
	role?: Role;
	email?: string;
	firstName?: string;
	lastName?: string;
	pendingInvite?: boolean;
	isBeta?: boolean;
	customRoles?: Array<Id>;
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
}

export class PatchOperation {
	op: string;
	path: string;
	value: any;
}
export class PatchComment {
	comment?: string;
	patch?: Array<PatchOperation>;
}
