export class MruCache {
	private readonly _map = new Map<string, boolean>();
	private readonly _entries = new Set<string>();

	public constructor(private readonly _maxSize: number = 5) {}

	public set(flagKey: string): void {
		// remove and re-add key so it is at end of set being most recently used.
		this._map.delete(flagKey);
		this._map.set(flagKey, true);
		this._entries.add(flagKey);
		for (const key of this._entries.keys()) {
			if (this._entries.size <= this._maxSize) {
				break;
			}
			console.log(key);
			this._map.delete(key);
			this._entries.delete(key);
		}
	}

	public has(flagKey: string): boolean {
		return this._map.has(flagKey);
	}

	public get(): IterableIterator<string> | undefined {
		return this._map.keys();
	}
}
