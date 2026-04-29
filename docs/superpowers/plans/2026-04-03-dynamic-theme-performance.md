# Dynamic Theme Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the white flash on page load and reduce runtime jank in Dark Reader's dynamic theme engine on Firefox.

**Architecture:** Two-phase rendering (instant dark fallback + progressive refinement), batched variable resolution via dirty flag scheduling, tiered sheet polling, consolidated MutationObservers, chunked stylesheet processing, inline style mutation batching with color-only fast path, and bounded LRU caches.

**Tech Stack:** TypeScript, Firefox WebExtension APIs, Jest (unit tests), Karma+Jasmine (inject tests)

**Spec:** `docs/superpowers/specs/2026-04-03-dynamic-theme-performance-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/cache.ts` | Modify | Add `LRUMap<K,V>` class |
| `src/utils/url.ts` | Modify | Bound `parsedURLCache` with LRU |
| `src/inject/dynamic-theme/modify-colors.ts` | Modify | Bound `colorModificationCache` with LRU + theme-change clearing |
| `src/inject/dynamic-theme/modify-css.ts` | Modify | Bound `imageDetailsCache` with LRU + timeout for awaiting |
| `src/inject/dynamic-theme/watch/sheet-changes.ts` | Modify | Replace RAF watcher with tiered setTimeout polling |
| `src/inject/dynamic-theme/variable-scheduler.ts` | Create | `VariableResolutionScheduler` with dirty flag + rAF batching |
| `src/inject/dynamic-theme/index.ts` | Modify | Phase 1 instant styles, chunked processing, use variable scheduler |
| `src/inject/dynamic-theme/inline-style.ts` | Modify | Two-level mutation batching + color-only fast path |
| `src/inject/dynamic-theme/instant-style.ts` | Create | Phase 1 instant dark fallback stylesheet generation |
| `src/inject/dynamic-theme/chunked-processor.ts` | Create | Time-budgeted stylesheet processing queue |
| `tests/unit/cache.tests.ts` | Create | LRUMap unit tests |
| `tests/unit/variable-scheduler.tests.ts` | Create | VariableResolutionScheduler unit tests |
| `tests/unit/tiered-watcher.tests.ts` | Create | Tiered sheet watcher unit tests |
| `tests/unit/chunked-processor.tests.ts` | Create | Chunked processor unit tests |
| `tests/unit/inline-style-batcher.tests.ts` | Create | Inline style batching unit tests |

---

## Task 1: LRUMap in cache.ts

**Files:**
- Modify: `src/utils/cache.ts`
- Create: `tests/unit/cache.tests.ts`

- [ ] **Step 1: Write failing tests for LRUMap**

Create `tests/unit/cache.tests.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/cache.tests.ts --config=tests/unit/jest.config.mjs`
Expected: FAIL — `LRUMap` is not exported from `../../src/utils/cache`

- [ ] **Step 3: Implement LRUMap**

Add to `src/utils/cache.ts` (before the existing `cachedFactory`):

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/cache.tests.ts --config=tests/unit/jest.config.mjs`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/cache.ts tests/unit/cache.tests.ts
git commit -m "feat: add LRUMap class for bounded caching"
```

---

## Task 2: Bound parsedURLCache

**Files:**
- Modify: `src/utils/url.ts:9-30`
- Modify: `src/inject/dynamic-theme/index.ts:899`

- [ ] **Step 1: Replace parsedURLCache with LRUMap**

In `src/utils/url.ts`, change line 9 from:

```typescript
export const parsedURLCache = new Map<string, URL>();
```

to:

```typescript
import {LRUMap} from './cache';

export const parsedURLCache = new LRUMap<string, URL>(512);
```

Remove the existing `import {cachedFactory} from './cache';` on line 3 if it becomes unused after this change. If `cachedFactory` is still used elsewhere in the file, keep it and add `LRUMap` to the import.

- [ ] **Step 2: Verify existing import of parsedURLCache in index.ts**

The `cleanDynamicThemeCache()` in `src/inject/dynamic-theme/index.ts:899` calls `parsedURLCache.clear()`. `LRUMap` has a `clear()` method, so no change needed.

- [ ] **Step 3: Run existing tests**

Run: `npm run test:unit`
Expected: All existing unit tests PASS (no behavioral change, just bounded)

- [ ] **Step 4: Commit**

```bash
git add src/utils/url.ts
git commit -m "feat: bound parsedURLCache to 512 entries with LRU eviction"
```

---

## Task 3: Bound colorModificationCache

**Files:**
- Modify: `src/inject/dynamic-theme/modify-colors.ts:26-85`

- [ ] **Step 1: Replace inner Map with LRUMap and add theme-change clearing**

In `src/inject/dynamic-theme/modify-colors.ts`, add import at top:

```typescript
import {LRUMap} from '../../utils/cache';
```

Change line 26 from:

```typescript
const colorModificationCache = new Map<HSLModifyFunction, Map<string, string>>();
```

to:

```typescript
const colorModificationCache = new Map<HSLModifyFunction, LRUMap<string, string>>();
```

Change lines 58-85 (`modifyColorWithCache`) — replace the inner map creation at line 63:

From:
```typescript
    } else {
        fnCache = new Map();
        colorModificationCache.set(modifyHSL, fnCache);
    }
```

To:
```typescript
    } else {
        fnCache = new LRUMap(2048);
        colorModificationCache.set(modifyHSL, fnCache);
    }
```

Add a `lastThemeCacheKey` tracker and modify `modifyColorWithCache` to detect theme changes. Add before line 58:

```typescript
let lastThemeCacheKey: string | null = null;

function getThemeCacheKey(theme: Theme): string {
    let key = '';
    themeCacheKeys.forEach((k) => {
        key += `${theme[k]};`;
    });
    return key;
}
```

Add at the start of `modifyColorWithCache` (inside the function, before the cache lookup):

```typescript
    const currentThemeCacheKey = getThemeCacheKey(theme);
    if (lastThemeCacheKey !== null && lastThemeCacheKey !== currentThemeCacheKey) {
        colorModificationCache.clear();
    }
    lastThemeCacheKey = currentThemeCacheKey;
```

- [ ] **Step 2: Run existing tests**

Run: `npm run test:unit`
Expected: All existing unit tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/inject/dynamic-theme/modify-colors.ts
git commit -m "feat: bound colorModificationCache with LRU + theme-change clearing"
```

---

## Task 4: Bound imageDetailsCache + timeout for awaitingForImageLoading

**Files:**
- Modify: `src/inject/dynamic-theme/modify-css.ts:307-308`

- [ ] **Step 1: Replace imageDetailsCache with LRUMap**

In `src/inject/dynamic-theme/modify-css.ts`, add import:

```typescript
import {LRUMap} from '../../utils/cache';
```

Change line 307 from:

```typescript
const imageDetailsCache = new Map<string, ImageDetails>();
```

to:

```typescript
const imageDetailsCache = new LRUMap<string, ImageDetails>(256);
```

- [ ] **Step 2: Add timeout for awaitingForImageLoading**

Find the code path where entries are added to `awaitingForImageLoading` (around lines 489-513). After each entry is added to `awaitingForImageLoading`, add a 30-second timeout that cleans up stale callbacks:

```typescript
const IMAGE_LOADING_TIMEOUT = 30000;

// After adding callbacks to awaitingForImageLoading:
setTimeout(() => {
    const callbacks = awaitingForImageLoading.get(url);
    if (callbacks) {
        awaitingForImageLoading.delete(url);
        callbacks.forEach((cb) => cb(null));
    }
}, IMAGE_LOADING_TIMEOUT);
```

- [ ] **Step 3: Verify cleanModificationCache still works**

Check that `cleanModificationCache()` at line 710-717 calls `imageDetailsCache.clear()` — `LRUMap` supports `.clear()` so no change needed.

- [ ] **Step 4: Run existing tests**

Run: `npm run test:unit`
Expected: All existing unit tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/inject/dynamic-theme/modify-css.ts
git commit -m "feat: bound imageDetailsCache with LRU + 30s timeout for stale image loading"
```

---

## Task 5: Tiered Sheet Watcher for Firefox

**Files:**
- Modify: `src/inject/dynamic-theme/watch/sheet-changes.ts:69-114`
- Create: `tests/unit/tiered-watcher.tests.ts`

- [ ] **Step 1: Write failing tests for tiered watcher**

Create `tests/unit/tiered-watcher.tests.ts`:

```typescript
import {createTieredSheetWatcher, TieredWatcherConfig, TIER_ACTIVE_INTERVAL, TIER_SETTLING_INTERVAL, TIER_IDLE_INTERVAL, TIER_ACTIVE_DURATION, TIER_SETTLING_DURATION} from '../../src/inject/dynamic-theme/watch/sheet-changes';

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

    it('should transition from active to settling tier', () => {
        const callback = jest.fn();
        const safeGetSheetRules = jest.fn(() => ({length: 5} as CSSRuleList));
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            safeGetSheetRules,
            callback,
            () => false,
        );
        watcher.start();

        // Active tier: polls every TIER_ACTIVE_INTERVAL
        const callsInActive = safeGetSheetRules.mock.calls.length;
        jest.advanceTimersByTime(TIER_ACTIVE_DURATION);
        const callsAfterActive = safeGetSheetRules.mock.calls.length;
        const activeCalls = callsAfterActive - callsInActive;

        // Settling tier: polls every TIER_SETTLING_INTERVAL
        safeGetSheetRules.mockClear();
        jest.advanceTimersByTime(TIER_SETTLING_INTERVAL * 3);
        const settlingCalls = safeGetSheetRules.mock.calls.length;

        // Settling should have fewer calls per unit time
        expect(settlingCalls).toBeLessThan(activeCalls);

        watcher.stop();
    });

    it('should reset to active tier on resetToActive()', () => {
        const safeGetSheetRules = jest.fn(() => ({length: 5} as CSSRuleList));
        const callback = jest.fn();
        const watcher = createTieredSheetWatcher(
            {} as HTMLStyleElement,
            safeGetSheetRules,
            callback,
            () => false,
        );
        watcher.start();

        // Advance past active into settling
        jest.advanceTimersByTime(TIER_ACTIVE_DURATION + TIER_SETTLING_DURATION);

        // Now in idle tier — reset
        safeGetSheetRules.mockClear();
        watcher.resetToActive();
        jest.advanceTimersByTime(TIER_ACTIVE_INTERVAL * 5);

        // Should be polling at active rate again
        expect(safeGetSheetRules.mock.calls.length).toBeGreaterThanOrEqual(4);

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/tiered-watcher.tests.ts --config=tests/unit/jest.config.mjs`
Expected: FAIL — `createTieredSheetWatcher` is not exported

- [ ] **Step 3: Implement tiered watcher**

In `src/inject/dynamic-theme/watch/sheet-changes.ts`, add the following constants and function. Keep the existing `createRAFSheetWatcher` (it's still used as a brief initial watcher before proxy is available) and add the new tiered watcher alongside it:

```typescript
export const TIER_ACTIVE_INTERVAL = 100;
export const TIER_SETTLING_INTERVAL = 500;
export const TIER_IDLE_INTERVAL = 2000;
export const TIER_ACTIVE_DURATION = 2000;
export const TIER_SETTLING_DURATION = 8000;

interface TieredSheetWatcher {
    start(): void;
    stop(): void;
    resetToActive(): void;
}

export function createTieredSheetWatcher(
    element: HTMLLinkElement | HTMLStyleElement,
    safeGetSheetRules: () => CSSRuleList | null,
    callback: () => void,
    isCancelled: () => boolean,
): TieredSheetWatcher {
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

    return {start, stop, resetToActive};
}
```

Then update `createSheetWatcher` to use the tiered watcher instead of the RAF watcher on Firefox. Change lines 23-26 from:

```typescript
        if (!__THUNDERBIRD__ && !(canUseSheetProxy && element.sheet)) {
            rafSheetWatcher = createRAFSheetWatcher(element, safeGetSheetRules, callback, isCancelled);
            rafSheetWatcher.start();
        }
```

to:

```typescript
        if (!__THUNDERBIRD__ && !(canUseSheetProxy && element.sheet)) {
            rafSheetWatcher = createTieredSheetWatcher(element, safeGetSheetRules, callback, isCancelled);
            rafSheetWatcher.start();
        }
```

Update the `rafSheetWatcher` variable type to support `resetToActive`:

```typescript
let rafSheetWatcher: SheetWatcher | TieredSheetWatcher | null = null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/tiered-watcher.tests.ts --config=tests/unit/jest.config.mjs`
Expected: All 5 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run test:unit`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/inject/dynamic-theme/watch/sheet-changes.ts tests/unit/tiered-watcher.tests.ts
git commit -m "feat: replace RAF sheet polling with tiered setTimeout watcher"
```

---

## Task 6: VariableResolutionScheduler

**Files:**
- Create: `src/inject/dynamic-theme/variable-scheduler.ts`
- Create: `tests/unit/variable-scheduler.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/variable-scheduler.tests.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/variable-scheduler.tests.ts --config=tests/unit/jest.config.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement VariableResolutionScheduler**

Create `src/inject/dynamic-theme/variable-scheduler.ts`:

```typescript
type ResolveFn = () => void;
type RAFFn = (callback: () => void) => number;

export class VariableResolutionScheduler {
    private dirty = false;
    private scheduled = false;
    private resolveFn: ResolveFn;
    private rafFn: RAFFn;
    private subscribers = new Set<() => void>();

    constructor(resolveFn: ResolveFn, rafFn: RAFFn = requestAnimationFrame.bind(window)) {
        this.resolveFn = resolveFn;
        this.rafFn = rafFn;
    }

    markDirty(): void {
        this.dirty = true;
        if (!this.scheduled) {
            this.scheduled = true;
            this.rafFn(() => {
                this.scheduled = false;
                if (this.dirty) {
                    this.resolve();
                }
            });
        }
    }

    flushIfDirty(): void {
        if (this.dirty) {
            this.resolve();
        }
    }

    subscribe(callback: () => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    private resolve(): void {
        this.dirty = false;
        this.resolveFn();
        this.subscribers.forEach((cb) => cb());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/variable-scheduler.tests.ts --config=tests/unit/jest.config.mjs`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/inject/dynamic-theme/variable-scheduler.ts tests/unit/variable-scheduler.tests.ts
git commit -m "feat: add VariableResolutionScheduler with dirty flag batching"
```

---

## Task 7: Replace matchVariablesAndDependents call sites with scheduler

**Files:**
- Modify: `src/inject/dynamic-theme/index.ts:274,298,317,376,490,504`
- Modify: `src/inject/dynamic-theme/inline-style.ts:199,232`

- [ ] **Step 1: Create and export scheduler instance in index.ts**

At the top of `src/inject/dynamic-theme/index.ts`, add import and create the scheduler:

```typescript
import {VariableResolutionScheduler} from './variable-scheduler';
```

After the existing global state declarations (around line 45), add:

```typescript
const variableScheduler = new VariableResolutionScheduler(
    () => variablesStore.matchVariablesAndDependents(),
);
export {variableScheduler};
```

- [ ] **Step 2: Replace call sites in index.ts**

Replace each `variablesStore.matchVariablesAndDependents()` call:

**Line 274** — inside `createDynamicStyleOverrides()`, after adding rules for matching:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.flushIfDirty();
```
Note: This is a synchronous boundary (we need variable types before rendering), so use `flushIfDirty()` after marking dirty. But first we need to mark dirty. Change the pattern to:

```typescript
variableScheduler.markDirty();
variableScheduler.flushIfDirty();
```

**Line 298** — after inline styles and adopted stylesheets:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
variableScheduler.flushIfDirty();
```

**Line 317** — inside Firefox adopted CSS change handler (if present):
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
```
(No flush needed — this is inside an async event handler, rAF will catch it)

**Line 376** — inside `createManager()` update callback:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
variableScheduler.flushIfDirty();
```
(Flush needed because `manager.render()` follows immediately on line 377)

**Line 490** — inside `watchForUpdates()` style change callback:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
variableScheduler.flushIfDirty();
```
(Flush needed because `manager.render()` follows on line 491)

**Line 504** — inside `watchForInlineStyles()` callback for root element `--` variables:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
variableScheduler.flushIfDirty();
```
(Flush needed because `putRootVars` follows on line 506)

- [ ] **Step 3: Replace call sites in inline-style.ts**

In `src/inject/dynamic-theme/inline-style.ts`, add import:

```typescript
import {variableScheduler} from './index';
```

**Line 199** — inside `discoverNodes()`:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
```
(No flush — discovery is batched, rAF will resolve)

**Line 232** — inside `handleAttributeMutations()`:
```typescript
// From:
variablesStore.matchVariablesAndDependents();
// To:
variableScheduler.markDirty();
```
(No flush — this is already throttled, rAF will resolve)

- [ ] **Step 4: Update cleanDynamicThemeCache**

In `src/inject/dynamic-theme/index.ts`, no additional cleanup needed — the scheduler just holds a boolean flag and a reference to `variablesStore.matchVariablesAndDependents`. The existing `variablesStore.clear()` call handles the actual data cleanup.

- [ ] **Step 5: Run inject tests**

Run: `npm run test:inject`
Expected: All inject tests PASS — behavioral equivalence maintained

- [ ] **Step 6: Commit**

```bash
git add src/inject/dynamic-theme/index.ts src/inject/dynamic-theme/inline-style.ts
git commit -m "feat: replace matchVariablesAndDependents calls with scheduler"
```

---

## Task 8: Phase 1 Instant Dark Fallback

**Files:**
- Create: `src/inject/dynamic-theme/instant-style.ts`
- Modify: `src/inject/dynamic-theme/index.ts`

- [ ] **Step 1: Create instant-style.ts**

Create `src/inject/dynamic-theme/instant-style.ts`:

```typescript
import type {Theme} from '../../definitions';

const INSTANT_CLASS = 'darkreader--instant';

export function injectInstantDarkStyle(theme: Theme): void {
    if (document.querySelector(`.${INSTANT_CLASS}`)) {
        return;
    }

    const bg = theme.darkSchemeBackgroundColor || '#181a1b';
    const text = theme.darkSchemeTextColor || '#e8e6e3';
    const inputBg = '#242628';
    const borderColor = '#3c3f41';
    const linkColor = '#6db3f2';

    const css = [
        `html, body { background-color: ${bg} !important; color: ${text} !important; }`,
        `img, video, canvas, iframe, embed, object, picture, svg image { filter: none !important; }`,
        `input, textarea, select, button { background-color: ${inputBg} !important; color: ${text} !important; border-color: ${borderColor} !important; }`,
        `a { color: ${linkColor} !important; }`,
        `table, th, td { border-color: ${borderColor} !important; }`,
        `::placeholder { color: ${borderColor} !important; }`,
    ].join('\n');

    const style = document.createElement('style');
    style.classList.add('darkreader');
    style.classList.add(INSTANT_CLASS);
    style.textContent = css;
    (document.head || document.documentElement).prepend(style);
}

export function removeInstantDarkStyle(): void {
    const el = document.querySelector(`.${INSTANT_CLASS}`);
    if (el) {
        el.remove();
    }
}

export function markPhaseComplete(): void {
    document.documentElement.setAttribute('data-darkreader-phase', 'complete');
}

export function clearPhaseAttribute(): void {
    document.documentElement.removeAttribute('data-darkreader-phase');
}
```

- [ ] **Step 2: Inject Phase 1 style at the earliest point in index.ts**

In `src/inject/dynamic-theme/index.ts`, add import:

```typescript
import {injectInstantDarkStyle, removeInstantDarkStyle, markPhaseComplete, clearPhaseAttribute} from './instant-style';
```

In `createOrUpdateDynamicThemeInternal()`, inject the instant style right after setting the `theme` variable (line 670). Add after `theme = themeConfig;`:

```typescript
    injectInstantDarkStyle(theme);
```

- [ ] **Step 3: Remove Phase 1 style after processing completes**

In the `runDynamicStyle()` function (line 415-418), after `createDynamicStyleOverrides()` and `watchForUpdates()` complete, add:

```typescript
function runDynamicStyle() {
    createDynamicStyleOverrides();
    watchForUpdates();
    removeInstantDarkStyle();
    markPhaseComplete();
}
```

- [ ] **Step 4: Clean up in removeDynamicTheme**

In `removeDynamicTheme()` (line 853), add cleanup:

```typescript
    removeInstantDarkStyle();
    clearPhaseAttribute();
```

Add these lines after the existing `document.documentElement.removeAttribute` calls (around line 855).

- [ ] **Step 5: Run inject tests**

Run: `npm run test:inject`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/inject/dynamic-theme/instant-style.ts src/inject/dynamic-theme/index.ts
git commit -m "feat: add Phase 1 instant dark fallback to eliminate white flash"
```

---

## Task 9: Chunked Stylesheet Processor

**Files:**
- Create: `src/inject/dynamic-theme/chunked-processor.ts`
- Create: `tests/unit/chunked-processor.tests.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/chunked-processor.tests.ts`:

```typescript
import {ChunkedStylesheetProcessor} from '../../src/inject/dynamic-theme/chunked-processor';

describe('ChunkedStylesheetProcessor', () => {
    let rafCallbacks: Array<() => void>;
    let processedSheets: string[];

    beforeEach(() => {
        rafCallbacks = [];
        processedSheets = [];
    });

    function mockRAF(cb: () => void): number {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
    }

    function flushRAF() {
        const cbs = [...rafCallbacks];
        rafCallbacks = [];
        cbs.forEach((cb) => cb());
    }

    function createSheet(id: string, processingTimeMs: number) {
        return {
            id,
            process: () => {
                processedSheets.push(id);
                // Simulate processing time via performance.now mock
            },
        };
    }

    it('should process all sheets eventually', () => {
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => { processedSheets.push(sheet.id); },
            onComplete,
            frameBudgetMs: 1000, // large budget so all fit in one frame
            rafFn: mockRAF,
            nowFn: () => 0,
        });

        processor.enqueue([
            {id: 'a'},
            {id: 'b'},
            {id: 'c'},
        ]);
        processor.start();
        flushRAF();

        expect(processedSheets).toEqual(['a', 'b', 'c']);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should split across frames when budget exceeded', () => {
        let time = 0;
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => {
                processedSheets.push(sheet.id);
                time += 10; // each sheet takes 10ms
            },
            onComplete,
            frameBudgetMs: 12, // budget for ~1 sheet
            rafFn: mockRAF,
            nowFn: () => time,
        });

        processor.enqueue([{id: 'a'}, {id: 'b'}, {id: 'c'}]);
        processor.start();

        // Frame 1: processes 'a' (10ms), tries 'b' (20ms > 12ms budget), stops
        flushRAF();
        expect(processedSheets).toEqual(['a', 'b']);
        expect(onComplete).not.toHaveBeenCalled();

        // Frame 2: processes 'c'
        time = 0; // reset for new frame
        flushRAF();
        expect(processedSheets).toEqual(['a', 'b', 'c']);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should prioritize critical sheets first', () => {
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => { processedSheets.push(sheet.id); },
            onComplete,
            frameBudgetMs: 1000,
            rafFn: mockRAF,
            nowFn: () => 0,
        });

        processor.enqueueCritical([{id: 'critical'}]);
        processor.enqueue([{id: 'standard'}]);
        processor.enqueueDeferred([{id: 'deferred'}]);
        processor.start();
        flushRAF();

        expect(processedSheets).toEqual(['critical', 'standard', 'deferred']);
    });

    it('should handle new sheets added during processing', () => {
        let time = 0;
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => {
                processedSheets.push(sheet.id);
                time += 10;
            },
            onComplete: jest.fn(),
            frameBudgetMs: 12,
            rafFn: mockRAF,
            nowFn: () => time,
        });

        processor.enqueue([{id: 'a'}, {id: 'b'}]);
        processor.start();
        flushRAF();
        // After frame 1, add a critical sheet
        processor.enqueueCritical([{id: 'urgent'}]);
        time = 0;
        flushRAF();
        // 'urgent' should be processed before remaining standard sheets
        expect(processedSheets).toContain('urgent');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/chunked-processor.tests.ts --config=tests/unit/jest.config.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChunkedStylesheetProcessor**

Create `src/inject/dynamic-theme/chunked-processor.ts`:

```typescript
interface ChunkedProcessorOptions<T> {
    processSheet: (sheet: T) => void;
    onComplete: () => void;
    frameBudgetMs?: number;
    rafFn?: (cb: () => void) => number;
    nowFn?: () => number;
}

const DEFAULT_FRAME_BUDGET = 12;

export class ChunkedStylesheetProcessor<T = unknown> {
    private criticalQueue: T[] = [];
    private standardQueue: T[] = [];
    private deferredQueue: T[] = [];
    private processSheet: (sheet: T) => void;
    private onComplete: () => void;
    private frameBudgetMs: number;
    private rafFn: (cb: () => void) => number;
    private nowFn: () => number;
    private running = false;

    constructor(options: ChunkedProcessorOptions<T>) {
        this.processSheet = options.processSheet;
        this.onComplete = options.onComplete;
        this.frameBudgetMs = options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET;
        this.rafFn = options.rafFn ?? requestAnimationFrame.bind(window);
        this.nowFn = options.nowFn ?? performance.now.bind(performance);
    }

    enqueueCritical(sheets: T[]): void {
        this.criticalQueue.push(...sheets);
        if (this.running) {
            this.scheduleNext();
        }
    }

    enqueue(sheets: T[]): void {
        this.standardQueue.push(...sheets);
    }

    enqueueDeferred(sheets: T[]): void {
        this.deferredQueue.push(...sheets);
    }

    removeFromQueue(predicate: (sheet: T) => boolean): void {
        this.criticalQueue = this.criticalQueue.filter((s) => !predicate(s));
        this.standardQueue = this.standardQueue.filter((s) => !predicate(s));
        this.deferredQueue = this.deferredQueue.filter((s) => !predicate(s));
    }

    start(): void {
        this.running = true;
        this.scheduleNext();
    }

    private scheduleNext(): void {
        this.rafFn(() => this.processNextBatch());
    }

    private getNextSheet(): T | undefined {
        if (this.criticalQueue.length > 0) {
            return this.criticalQueue.shift();
        }
        if (this.standardQueue.length > 0) {
            return this.standardQueue.shift();
        }
        if (this.deferredQueue.length > 0) {
            return this.deferredQueue.shift();
        }
        return undefined;
    }

    private hasMore(): boolean {
        return this.criticalQueue.length > 0 ||
            this.standardQueue.length > 0 ||
            this.deferredQueue.length > 0;
    }

    private processNextBatch(): void {
        const startTime = this.nowFn();

        while (this.hasMore()) {
            const sheet = this.getNextSheet()!;
            this.processSheet(sheet);
            if (this.nowFn() - startTime > this.frameBudgetMs) {
                break;
            }
        }

        if (this.hasMore()) {
            this.scheduleNext();
        } else {
            this.running = false;
            this.onComplete();
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/chunked-processor.tests.ts --config=tests/unit/jest.config.mjs`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/inject/dynamic-theme/chunked-processor.ts tests/unit/chunked-processor.tests.ts
git commit -m "feat: add ChunkedStylesheetProcessor with time-budgeted batching"
```

---

## Task 10: Integrate Chunked Processing into index.ts

**Files:**
- Modify: `src/inject/dynamic-theme/index.ts:259-300`

- [ ] **Step 1: Import ChunkedStylesheetProcessor**

In `src/inject/dynamic-theme/index.ts`, add:

```typescript
import {ChunkedStylesheetProcessor} from './chunked-processor';
```

- [ ] **Step 2: Refactor createDynamicStyleOverrides to use chunked processing**

Replace the synchronous processing in `createDynamicStyleOverrides()` with the chunked processor. The key change is splitting the function into: (1) collect styles and create managers, (2) enqueue for chunked processing, (3) process in batches.

Replace the body of `createDynamicStyleOverrides()` (lines 259-300):

```typescript
function createDynamicStyleOverrides() {
    cancelRendering();

    const allStyles = getManageableStyles(document);

    const newManagers = allStyles
        .filter((style) => !styleManagers.has(style))
        .map((style) => createManager(style));

    // Collect details for variable matching
    newManagers
        .map((manager) => manager.details({secondRound: false}))
        .filter((detail) => detail && detail.rules.length > 0)
        .forEach((detail) => {
            variablesStore.addRulesForMatching(detail!.rules);
        });

    variableScheduler.markDirty();
    variableScheduler.flushIfDirty();
    variablesStore.setOnRootVariableChange(() => {
        const rootVarsStyle = createOrUpdateStyle('darkreader--root-vars');
        variablesStore.putRootVars(rootVarsStyle, theme!);
    });
    const rootVarsStyle = createOrUpdateStyle('darkreader--root-vars');
    variablesStore.putRootVars(rootVarsStyle, theme!);

    // Prioritize: head styles are critical, body styles are standard
    const criticalManagers: StyleManager[] = [];
    const standardManagers: StyleManager[] = [];

    newManagers.forEach((manager) => {
        // Use styleManagers to find the element for this manager
        for (const [element, mgr] of styleManagers) {
            if (mgr === manager) {
                const isInHead = element.parentNode === document.head ||
                    (element as HTMLElement).closest?.('head') !== null;
                if (isInHead) {
                    criticalManagers.push(manager);
                } else {
                    standardManagers.push(manager);
                }
                break;
            }
        }
    });

    // Use chunked processor for rendering
    const processor = new ChunkedStylesheetProcessor<StyleManager>({
        processSheet: (manager) => {
            manager.render(theme!, ignoredImageAnalysisSelectors);
        },
        onComplete: () => {
            removeInstantDarkStyle();
            markPhaseComplete();
            if (loadingStyles.size === 0) {
                cleanFallbackStyle();
            }
        },
    });

    processor.enqueueCritical(criticalManagers);
    processor.enqueue(standardManagers);
    processor.start();

    newManagers.forEach((manager) => manager.watch());

    // Inline styles and adopted stylesheets — process immediately
    const inlineStyleElements = toArray(document.querySelectorAll(INLINE_STYLE_SELECTOR)) as HTMLElement[];
    iterateShadowHosts(document.documentElement, (host) => {
        createShadowStaticStyleOverrides(host.shadowRoot!);
        const elements = host.shadowRoot!.querySelectorAll(INLINE_STYLE_SELECTOR);
        if (elements.length > 0) {
            push(inlineStyleElements, elements);
        }
    });
    inlineStyleElements.forEach((el: HTMLElement) => overrideInlineStyle(el, theme!, ignoredInlineSelectors, ignoredImageAnalysisSelectors));
    handleAdoptedStyleSheets(document);
    variableScheduler.markDirty();
    variableScheduler.flushIfDirty();

    tryInvertChromePDF();
}
```

- [ ] **Step 3: Update runDynamicStyle to not duplicate Phase 1 cleanup**

Since Phase 1 cleanup now happens in the chunked processor's `onComplete`, update `runDynamicStyle()`:

```typescript
function runDynamicStyle() {
    createDynamicStyleOverrides();
    watchForUpdates();
}
```

(Remove the `removeInstantDarkStyle()` and `markPhaseComplete()` calls that were added in Task 8 Step 3 — they're now in the processor's onComplete.)

- [ ] **Step 4: Run inject tests**

Run: `npm run test:inject`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/inject/dynamic-theme/index.ts
git commit -m "feat: integrate chunked stylesheet processing with priority queues"
```

---

## Task 11: Inline Style Mutation Batching with Color-Only Fast Path

**Files:**
- Modify: `src/inject/dynamic-theme/inline-style.ts:161-267`

- [ ] **Step 1: Define color-related properties set**

At the top of `src/inject/dynamic-theme/inline-style.ts`, add:

```typescript
const COLOR_PROPERTIES = new Set([
    'color', 'background', 'background-color', 'background-image',
    'border-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color',
    'outline-color', 'fill', 'stroke', 'stop-color',
    'box-shadow', 'text-shadow', 'text-decoration-color',
    'column-rule-color', 'caret-color', 'flood-color', 'lighting-color',
]);

const lastSeenStyles = new WeakMap<HTMLElement, string>();
```

- [ ] **Step 2: Add color-only detection function**

```typescript
function hasColorPropertyChanged(element: HTMLElement): boolean {
    const currentCSS = element.style.cssText;
    const previousCSS = lastSeenStyles.get(element);
    lastSeenStyles.set(element, currentCSS);

    if (previousCSS === undefined) {
        return true; // first time seeing this element
    }
    if (previousCSS === currentCSS) {
        return false; // no change at all
    }

    // Parse both and compare color-related properties
    const currentProps = parseStyleProps(currentCSS);
    const previousProps = parseStyleProps(previousCSS);

    for (const prop of COLOR_PROPERTIES) {
        if (currentProps.get(prop) !== previousProps.get(prop)) {
            return true;
        }
    }
    return false;
}

function parseStyleProps(cssText: string): Map<string, string> {
    const props = new Map<string, string>();
    const parts = cssText.split(';');
    for (const part of parts) {
        const colonIndex = part.indexOf(':');
        if (colonIndex > 0) {
            const name = part.substring(0, colonIndex).trim();
            const value = part.substring(colonIndex + 1).trim();
            props.set(name, value);
        }
    }
    return props;
}
```

- [ ] **Step 3: Replace the attribute mutation handling in deepWatchForInlineStyles**

Replace the `handleAttributeMutations` throttled function and the `attrObserver` callback (lines 220-266) with batched processing:

```typescript
    const pendingElements = new Set<HTMLElement>();
    let batchScheduled = false;

    function processBatch() {
        batchScheduled = false;
        for (const element of pendingElements) {
            if (hasColorPropertyChanged(element)) {
                elementStyleDidChange(element);
            }
        }
        pendingElements.clear();
        variableScheduler.markDirty();
    }

    const attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (INLINE_STYLE_ATTRS.includes(m.attributeName!)) {
                pendingElements.add(m.target as HTMLElement);
            }
        }
        if (pendingElements.size > 0 && !batchScheduled) {
            batchScheduled = true;
            requestAnimationFrame(processBatch);
        }
    });
    attrObserver.observe(root, {
        attributes: true,
        attributeFilter: INLINE_STYLE_ATTRS.concat(overridesList.map(({dataAttr}) => dataAttr)),
        subtree: true,
    });
    attrObservers.set(root, attrObserver);
```

This replaces the existing throttled handler and its retry/caching logic (lines 212-266). The new approach:
1. Collects mutated elements in a `Set` (deduplicates automatically)
2. Schedules one rAF callback per frame
3. Skips elements whose only changes are non-color properties
4. Calls `variableScheduler.markDirty()` once per batch, not per element

- [ ] **Step 4: Update stopWatchingForInlineStyles cleanup**

No changes needed — `stopWatchingForInlineStyles()` already disconnects all attr observers and tree observers.

- [ ] **Step 5: Run inject tests**

Run: `npm run test:inject`
Expected: All tests PASS — inline style overrides still applied correctly

- [ ] **Step 6: Commit**

```bash
git add src/inject/dynamic-theme/inline-style.ts
git commit -m "feat: batch inline style mutations with color-only fast path"
```

---

## Task 12: MutationObserver Consolidation

> **Note:** This is the most complex task as it touches multiple observer creation patterns. Implement carefully and test each step.

**Files:**
- Create: `src/inject/dynamic-theme/watch/consolidated-observers.ts`
- Modify: `src/inject/dynamic-theme/inline-style.ts`
- Modify: `src/inject/utils/dom.ts`
- Modify: `src/inject/dynamic-theme/index.ts`

- [ ] **Step 1: Create consolidated attribute observer**

Create `src/inject/dynamic-theme/watch/consolidated-observers.ts`:

```typescript
type AttributeHandler = (element: Element, attributeName: string) => void;
type StyleContentHandler = (styleElement: Element) => void;

const attributeHandlerRegistry = new WeakMap<Element, AttributeHandler[]>();
const styleContentHandlerRegistry = new WeakMap<Element, StyleContentHandler>();

interface ConsolidatedAttributeObserver {
    register(element: Element, handler: AttributeHandler): void;
    unregister(element: Element): void;
    disconnect(): void;
}

interface ConsolidatedStyleContentObserver {
    register(styleElement: Element, handler: StyleContentHandler): void;
    unregister(styleElement: Element): void;
    disconnect(): void;
}

const attributeObservers = new Map<Node, ConsolidatedAttributeObserver>();
const styleContentObservers = new Map<Node, ConsolidatedStyleContentObserver>();

const WATCHED_ATTRIBUTES = ['style', 'class', 'media', 'disabled', 'type'];

export function getConsolidatedAttributeObserver(root: Document | ShadowRoot): ConsolidatedAttributeObserver {
    if (attributeObservers.has(root)) {
        return attributeObservers.get(root)!;
    }

    const registry = new Map<Element, AttributeHandler[]>();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const target = mutation.target as Element;
            const handlers = registry.get(target);
            if (handlers) {
                for (const handler of handlers) {
                    handler(target, mutation.attributeName!);
                }
            }
        }
    });

    observer.observe(root, {
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
        subtree: true,
    });

    const consolidated: ConsolidatedAttributeObserver = {
        register(element: Element, handler: AttributeHandler): void {
            const existing = registry.get(element) || [];
            existing.push(handler);
            registry.set(element, existing);
        },
        unregister(element: Element): void {
            registry.delete(element);
        },
        disconnect(): void {
            observer.disconnect();
            registry.clear();
            attributeObservers.delete(root);
        },
    };

    attributeObservers.set(root, consolidated);
    return consolidated;
}

export function getConsolidatedStyleContentObserver(root: Document | ShadowRoot): ConsolidatedStyleContentObserver {
    if (styleContentObservers.has(root)) {
        return styleContentObservers.get(root)!;
    }

    const registry = new Map<Element, StyleContentHandler>();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const target = mutation.target;
            // characterData targets the text node; check parentElement
            const styleElement = target.nodeType === Node.TEXT_NODE
                ? target.parentElement
                : target as Element;
            if (styleElement && registry.has(styleElement)) {
                registry.get(styleElement)!(styleElement);
            }
        }
    });

    observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
    });

    const consolidated: ConsolidatedStyleContentObserver = {
        register(styleElement: Element, handler: StyleContentHandler): void {
            registry.set(styleElement, handler);
        },
        unregister(styleElement: Element): void {
            registry.delete(styleElement);
        },
        disconnect(): void {
            observer.disconnect();
            registry.clear();
            styleContentObservers.delete(root);
        },
    };

    styleContentObservers.set(root, consolidated);
    return consolidated;
}

export function disconnectAllConsolidatedObservers(): void {
    attributeObservers.forEach((obs) => obs.disconnect());
    styleContentObservers.forEach((obs) => obs.disconnect());
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm run test:inject`
Expected: All tests PASS (no behavioral changes yet — just added new module)

- [ ] **Step 3: Commit the new module**

```bash
git add src/inject/dynamic-theme/watch/consolidated-observers.ts
git commit -m "feat: add consolidated MutationObserver module with WeakMap dispatch"
```

- [ ] **Step 4: Integrate consolidated observers gradually**

Integration of the consolidated observers into the existing code (replacing per-element observers in `style-manager.ts`, `inline-style.ts`, and `dom.ts`) requires careful, file-by-file migration. This step should be done incrementally:

1. Start with `inline-style.ts` — replace the per-root `attrObserver` with `getConsolidatedAttributeObserver(root)`. The batching logic from Task 11 remains; it just feeds into the consolidated observer's dispatch instead of its own observer.

2. Then migrate per-style-element observers in `style-manager.ts` — replace individual MutationObservers per `<style>` element with registrations on the consolidated style content observer.

3. Finally, migrate node position watchers in `dom.ts` — consolidate into the existing tree observer.

Each sub-step should be followed by running `npm run test:inject` to verify no regressions.

- [ ] **Step 5: Add cleanup to removeDynamicTheme**

In `src/inject/dynamic-theme/index.ts`, inside `removeDynamicTheme()`, add:

```typescript
import {disconnectAllConsolidatedObservers} from './watch/consolidated-observers';

// Inside removeDynamicTheme(), after existing observer cleanup:
disconnectAllConsolidatedObservers();
```

- [ ] **Step 6: Run full test suite**

Run: `npm run test:inject`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/inject/dynamic-theme/watch/consolidated-observers.ts src/inject/dynamic-theme/inline-style.ts src/inject/dynamic-theme/index.ts src/inject/utils/dom.ts
git commit -m "feat: consolidate MutationObservers to 3 per root with WeakMap dispatch"
```

---

## Implementation Order & Dependencies

```
Task 1: LRUMap (foundation)
  ├── Task 2: parsedURLCache bounding
  ├── Task 3: colorModificationCache bounding
  └── Task 4: imageDetailsCache bounding

Task 5: Tiered sheet watcher (independent)

Task 6: VariableResolutionScheduler
  └── Task 7: Replace call sites
       └── Task 11: Inline style batching (uses variableScheduler.markDirty)

Task 8: Phase 1 instant dark fallback
  └── Task 10: Integrate chunked processing (uses instant style removal in onComplete)

Task 9: ChunkedStylesheetProcessor (independent module)
  └── Task 10: Integrate into index.ts

Task 12: MutationObserver consolidation (independent, can be done anytime)
```

**Recommended execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9 → 8 → 10 → 11 → 12

Tasks 1-5 are independent of each other (after Task 1 provides LRUMap). Tasks within parallel tracks (e.g., 2,3,4) can be done in any order.
