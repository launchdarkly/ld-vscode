export class Resource {
	name: string;
	key: string;
	tags: Array<string>;
	_version: number;
}

export class Project extends Resource {
	environments: Array<Environment>;
}

export class Environment extends Resource {
	apiKey: string;
	version: number;
	_site: { href: string };
}

export class Flag extends Resource {
	environments: Map<String, Environment>;

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

export class FlagConfiguration {
	key: string;
	variations: Array<any>;
	offVariation: any;
	fallthrough: any;
	prerequisites: any;
	targets: any;
	rules: Array<any>;
	on: boolean;
	version: number;
}

export class FlagWithConfiguration {
	flag: Flag;
	config: FlagConfiguration;
}
