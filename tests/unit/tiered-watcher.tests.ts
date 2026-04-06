import {createTieredSheetWatcher, TIER_ACTIVE_INTERVAL, TIER_SETTLING_INTERVAL, TIER_IDLE_INTERVAL, TIER_ACTIVE_DURATION, TIER_SETTLING_DURATION} from '../../src/inject/dynamic-theme/watch/sheet-changes';

describe('createTieredSheetWatcher', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should call callback when rules change', () => {
        let ruleCount = 5;
        const callback = jest.fn();
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            () => ({length: ruleCount} as CSSRuleList),
            callback,
            () => false,
        );
        watcher.start();
        ruleCount = 6;
        jest.advanceTimersByTime(TIER_ACTIVE_INTERVAL);
        expect(callback).toHaveBeenCalledTimes(1);
        watcher.stop();
    });

    it('should not call callback when rules unchanged', () => {
        const callback = jest.fn();
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            () => ({length: 5} as CSSRuleList),
            callback,
            () => false,
        );
        watcher.start();
        jest.advanceTimersByTime(TIER_ACTIVE_INTERVAL * 10);
        expect(callback).not.toHaveBeenCalled();
        watcher.stop();
    });

    it('should stop polling when stopped', () => {
        const safeGetSheetRules = jest.fn(() => ({length: 5} as CSSRuleList));
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            safeGetSheetRules,
            jest.fn(),
            () => false,
        );
        watcher.start();
        watcher.stop();
        safeGetSheetRules.mockClear();
        jest.advanceTimersByTime(5000);
        expect(safeGetSheetRules.mock.calls.length).toBe(0);
    });

    it('should reset to active tier on resetToActive()', () => {
        const safeGetSheetRules = jest.fn(() => ({length: 5} as CSSRuleList));
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            safeGetSheetRules,
            jest.fn(),
            () => false,
        );
        watcher.start();
        // Advance past active+settling into idle
        jest.advanceTimersByTime(TIER_ACTIVE_DURATION + TIER_SETTLING_DURATION + 1000);
        safeGetSheetRules.mockClear();
        watcher.resetToActive();
        jest.advanceTimersByTime(TIER_ACTIVE_INTERVAL * 5);
        // Should be polling at active rate again
        expect(safeGetSheetRules.mock.calls.length).toBeGreaterThanOrEqual(4);
        watcher.stop();
    });
});
