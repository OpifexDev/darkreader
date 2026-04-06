import {LRUMap} from '../../src/utils/cache';

describe('LRUMap', () => {
    it('should store and retrieve values', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        map.set('b', 2);
        expect(map.get('a')).toBe(1);
        expect(map.get('b')).toBe(2);
    });

    it('should return undefined for missing keys', () => {
        const map = new LRUMap<string, number>(3);
        expect(map.get('x')).toBeUndefined();
    });

    it('should evict least recently used when over capacity', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3);
        map.set('d', 4); // evicts 'a'
        expect(map.get('a')).toBeUndefined();
        expect(map.get('b')).toBe(2);
        expect(map.get('d')).toBe(4);
    });

    it('should promote accessed entries', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3);
        map.get('a'); // promote 'a'
        map.set('d', 4); // evicts 'b' (not 'a')
        expect(map.get('a')).toBe(1);
        expect(map.get('b')).toBeUndefined();
    });

    it('should report correct size', () => {
        const map = new LRUMap<string, number>(2);
        map.set('a', 1);
        map.set('b', 2);
        expect(map.size).toBe(2);
        map.set('c', 3);
        expect(map.size).toBe(2);
    });

    it('should clear all entries', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        map.set('b', 2);
        map.clear();
        expect(map.size).toBe(0);
        expect(map.get('a')).toBeUndefined();
    });

    it('should support has()', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        expect(map.has('a')).toBe(true);
        expect(map.has('b')).toBe(false);
    });

    it('should support delete()', () => {
        const map = new LRUMap<string, number>(3);
        map.set('a', 1);
        map.delete('a');
        expect(map.has('a')).toBe(false);
        expect(map.size).toBe(0);
    });
});
