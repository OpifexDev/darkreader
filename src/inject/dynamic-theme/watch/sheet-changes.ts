declare const __THUNDERBIRD__: boolean;

interface SheetWatcher {
    start(): void;
    stop(): void;
}

let canUseSheetProxy = false;
document.addEventListener('__darkreader__inlineScriptsAllowed', () => canUseSheetProxy = true, {once: true});

export function createSheetWatcher(
    element: HTMLLinkElement | HTMLStyleElement,
    safeGetSheetRules: () => CSSRuleList | null,
    callback: () => void,
    isCancelled: () => boolean,
): SheetWatcher {
    let rafSheetWatcher: SheetWatcher | {start(): void; stop(): void; resetToActive(): void} | null = null;

    function watchForSheetChanges() {
        watchForSheetChangesUsingProxy();
        // Sometimes sheet can be null in Firefox and Safari
        // So need to watch for it using rAF
        if (!__THUNDERBIRD__ && !(canUseSheetProxy && element.sheet)) {
            rafSheetWatcher = createTieredSheetWatcher(element, safeGetSheetRules, callback, isCancelled);
            rafSheetWatcher.start();
        }
    }

    let areSheetChangesPending = false;

    function onSheetChange() {
        canUseSheetProxy = true;
        rafSheetWatcher?.stop();
        if (areSheetChangesPending) {
            return;
        }

        function handleSheetChanges() {
            areSheetChangesPending = false;
            if (isCancelled()) {
                return;
            }
            callback();
        }

        areSheetChangesPending = true;
        queueMicrotask(handleSheetChanges);
    }

    function watchForSheetChangesUsingProxy() {
        element.addEventListener('__darkreader__updateSheet', onSheetChange);
    }

    function stopWatchingForSheetChangesUsingProxy() {
        element.removeEventListener('__darkreader__updateSheet', onSheetChange);
    }

    function stopWatchingForSheetChanges() {
        stopWatchingForSheetChangesUsingProxy();
        rafSheetWatcher?.stop();
    }

    return {
        start: watchForSheetChanges,
        stop: stopWatchingForSheetChanges,
    };
}

const activeTieredWatchers = new Set<{resetToActive(): void}>();

export function resetAllTieredWatchers(): void {
    activeTieredWatchers.forEach((w) => w.resetToActive());
}

export const TIER_ACTIVE_INTERVAL = 100;
export const TIER_SETTLING_INTERVAL = 500;
export const TIER_IDLE_INTERVAL = 2000;
export const TIER_ACTIVE_DURATION = 2000;
export const TIER_SETTLING_DURATION = 8000;

export function createTieredSheetWatcher(
    element: HTMLLinkElement | HTMLStyleElement,
    safeGetSheetRules: () => CSSRuleList | null,
    callback: () => void,
    isCancelled: () => boolean,
): {start(): void; stop(): void; resetToActive(): void} {
    let rulesChangeKey: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let tierStartTime = 0;

    function getRulesChangeKey(): number | null {
        const rules = safeGetSheetRules();
        return rules ? rules.length : null;
    }

    function getCurrentInterval(): number {
        const elapsed = Date.now() - tierStartTime;
        if (elapsed < TIER_ACTIVE_DURATION) {
            return TIER_ACTIVE_INTERVAL;
        }
        if (elapsed < TIER_ACTIVE_DURATION + TIER_SETTLING_DURATION) {
            return TIER_SETTLING_INTERVAL;
        }
        return TIER_IDLE_INTERVAL;
    }

    function poll() {
        if (isCancelled()) {
            return;
        }
        const newKey = getRulesChangeKey();
        if (newKey !== rulesChangeKey) {
            rulesChangeKey = newKey;
            callback();
        }
        timerId = setTimeout(poll, getCurrentInterval());
    }

    function start() {
        tierStartTime = Date.now();
        rulesChangeKey = getRulesChangeKey();
        timerId = setTimeout(poll, getCurrentInterval());
    }

    function stop() {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    function resetToActive() {
        stop();
        tierStartTime = Date.now();
        timerId = setTimeout(poll, TIER_ACTIVE_INTERVAL);
    }

    const watcher = {start, stop, resetToActive};
    activeTieredWatchers.add(watcher);

    const originalStop = stop;
    function stopAndUnregister() {
        originalStop();
        activeTieredWatchers.delete(watcher);
    }

    return {start, stop: stopAndUnregister, resetToActive};
}
