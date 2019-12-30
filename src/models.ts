export class Resource {
	name: string;
	key: string;
	tags: Array<string>;
}

export class Flag extends Resource {
	environments: Map<String, Environment>;
}

export class Environment extends Resource {
	_site: { href: string };
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
}
