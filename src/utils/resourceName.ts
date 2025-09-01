interface HasNameAndValue {
	name?: string;
	key?: string;
	value: unknown;
}
export function resourceName<T extends HasNameAndValue>(obj: T): string {
	return JSON.stringify(obj['name']) ? JSON.stringify(obj['name']) : JSON.stringify(obj['value']);
}
