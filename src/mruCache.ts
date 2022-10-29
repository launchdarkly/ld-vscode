export class MruCache {

	private readonly _map = new Map<string, T>();
	private readonly _entries = new Set<string>();
    
	public constructor(
	    private readonly _maxSize: number = 5
	) { }
    
	public set(flagKey: string): void {
	    this._map.set(flagKey, true);
	    for (const key of this._entries.keys()) {
		if (this._entries.size <= this._maxSize) {
		    break;
		}
		this._map.delete(key);
		this._entries.delete(key);
	    }
	}
    
	public has(flagKey: string): boolean {
	    return this._map.has(flagKey);
	}
    
	public get(): IterableIterator<T> | undefined {
		return this._map.keys();
	}
    }