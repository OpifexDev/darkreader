export class LRUMap<K, V> {
    private map = new Map<K, V>();
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.maxSize) {
            const first = this.map.keys().next().value!;
            this.map.delete(first);
        }
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

export function cachedFactory<K, V>(factory: (key: K) => V, size: number): (key: K) => V {
    const cache = new Map<K, V>();

    return (key: K) => {
        if (cache.has(key)) {
            return cache.get(key)!;
        }
        const value = factory(key);
        cache.set(key, value);
        if (cache.size > size) {
            const first = cache.keys().next().value!;
            cache.delete(first);
        }
        return value;
    };
}
