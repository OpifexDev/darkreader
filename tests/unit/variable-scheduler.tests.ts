import {VariableResolutionScheduler} from '../../src/inject/dynamic-theme/variable-scheduler';

describe('VariableResolutionScheduler', () => {
    let resolveCount: number;
    let scheduler: VariableResolutionScheduler;
    let rafCallbacks: Array<() => void>;

    beforeEach(() => {
        resolveCount = 0;
        rafCallbacks = [];
        const mockRAF = (cb: () => void) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        };
        scheduler = new VariableResolutionScheduler(
            () => { resolveCount++; },
            mockRAF as unknown as typeof requestAnimationFrame,
        );
    });

    it('should not resolve until frame fires', () => {
        scheduler.markDirty();
        expect(resolveCount).toBe(0);
    });

    it('should resolve once per frame regardless of markDirty count', () => {
        scheduler.markDirty();
        scheduler.markDirty();
        scheduler.markDirty();
        rafCallbacks.forEach((cb) => cb());
        expect(resolveCount).toBe(1);
    });

    it('should not resolve if not dirty', () => {
        rafCallbacks.forEach((cb) => cb());
        expect(resolveCount).toBe(0);
    });

    it('should notify subscribers after resolution', () => {
        const subscriber = jest.fn();
        scheduler.subscribe(subscriber);
        scheduler.markDirty();
        rafCallbacks.forEach((cb) => cb());
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should support unsubscribe', () => {
        const subscriber = jest.fn();
        const unsub = scheduler.subscribe(subscriber);
        unsub();
        scheduler.markDirty();
        rafCallbacks.forEach((cb) => cb());
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('should resolve synchronously on flushIfDirty', () => {
        scheduler.markDirty();
        scheduler.flushIfDirty();
        expect(resolveCount).toBe(1);
    });

    it('should not double-resolve after flush + frame', () => {
        scheduler.markDirty();
        scheduler.flushIfDirty();
        rafCallbacks.forEach((cb) => cb());
        expect(resolveCount).toBe(1);
    });
});
