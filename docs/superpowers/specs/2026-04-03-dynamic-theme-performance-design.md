# Dynamic Theme Performance Optimization

**Date:** 2026-04-03
**Target:** Dark Reader fork, Firefox only
**Focus:** Initial page load latency + runtime jank during interaction
**Visual trade-off:** Small compromises acceptable (progressive refinement)

---

## Overview

Dark Reader's dynamic theme engine intercepts all page stylesheets, parses every CSS declaration, transforms colors via HSL manipulation, and injects modified CSS — while watching for DOM mutations, stylesheet changes, and inline style modifications. This design addresses two primary performance problems:

1. **Initial page load latency** — the "flash of white" before dark styles are applied
2. **Runtime jank** — dropped frames during DOM mutations, stylesheet changes, and inline style updates

Target pages: complex web apps (dashboards, SPAs) with heavy CSS variable usage, frequent DOM mutations, and dynamic inline styles (React, Vue, Material UI, Tailwind, etc.).

---

## Section 1: Two-Phase Rendering Architecture

### Phase 1 — Instant Dark Fallback (~1ms)

Injected immediately on `ADD_DYNAMIC_THEME` message, before any stylesheet parsing begins.

**Implementation:**
- A single `<style class="darkreader--instant">` element inserted into `<head>`
- Contains generic dark overrides using the user's configured theme colors (background/text), not hardcoded values:
  - `html, body` — dark background, light text
  - `img, video, canvas, iframe, embed, object` — protected from inversion (`filter: none`)
  - `input, textarea, select, button` — dark form controls
  - `a` — accessible link color
- Uses low-specificity selectors (element selectors only, no classes/IDs) so Phase 2 styles naturally override without removal conflicts

**Entry point:** `createOrUpdateDynamicTheme()` in `src/inject/dynamic-theme/index.ts`

### Phase 2 — Progressive Refinement

The existing dynamic theme pipeline runs, but with chunked processing (see Section 5).

- Stylesheets processed in time-budgeted batches per `requestAnimationFrame` callback
- Each batch's results injected immediately — users see accuracy improve incrementally
- Phase 1 styles remain active throughout; Phase 2 styles win via higher specificity

### Handoff

- No explicit per-element removal of Phase 1 styles needed during processing
- Once all stylesheets are processed:
  1. Remove `darkreader--instant` stylesheet in one operation
  2. Set `data-darkreader-phase="complete"` attribute on `<html>`
  3. Switch sheet watcher to normal monitoring mode

---

## Section 2: Batched Variable Resolution

### Problem

`matchVariablesAndDependents()` in `src/inject/dynamic-theme/variables.ts` is called at ~10 call sites during init and from inline style mutation handlers. Each call iterates all queued CSS rules, iterates all declarations within those rules, and resolves variable dependency chains with recursive `findVarRef()` calls. On pages with 300+ CSS variables (Material UI, Tailwind), a single call takes 5-20ms. Ten redundant calls = 50-200ms wasted.

**Call sites in `src/inject/dynamic-theme/index.ts`:** lines 274, 298, 317, 376, 448, 490, 504
**Call sites in `src/inject/dynamic-theme/inline-style.ts`:** lines 199, 232

### Design

Introduce a `VariableResolutionScheduler` that wraps the variables store:

1. All call sites replaced with `variableScheduler.markDirty()` — sets a single boolean flag (effectively free)
2. A single `requestAnimationFrame` callback checks the flag:
   - If dirty: run `matchVariablesAndDependents()` once, set `dirty = false`, notify subscribers
   - If clean: no-op
3. Subscribers (style managers that depend on variable types) are notified after resolution, triggering their re-render in the same frame

**Synchronous escape hatch:** `variableScheduler.flushIfDirty()` — for code paths that need variable types resolved before proceeding (e.g., phase boundaries in chunked processing). Used sparingly, only at processing phase boundaries.

**Impact:** Variable resolution runs once per frame instead of 10+ times. On a page with 300 CSS variables, saves 50-180ms during initialization.

---

## Section 3: Firefox-Optimized Sheet Watching

### Problem

Firefox doesn't support the stylesheet proxy mechanism, so Dark Reader falls back to `createRAFSheetWatcher` in `src/inject/dynamic-theme/watch/sheet-changes.ts` — a `requestAnimationFrame` loop that accesses `element.sheet.cssRules` every frame (~16ms) for each managed stylesheet. On a page with 20 stylesheets: 20 `cssRules` accesses x 60 fps = 1200 accesses/sec, each potentially triggering style recalculation in Gecko.

### Design

Replace RAF polling with a tiered polling strategy using `setTimeout`:

**Tier 1 — Active (first 2 seconds after page load or DOM change):**
- Poll every 100ms
- Catches rapid initial stylesheet changes during framework hydration, CSS-in-JS injection
- 10 polls/sec vs current 60 = 6x reduction

**Tier 2 — Settling (2-10 seconds after load):**
- Poll every 500ms
- Page is mostly loaded; lazy components and deferred stylesheets still arriving
- Acceptable detection latency for incremental updates

**Tier 3 — Idle (after 10 seconds):**
- Poll every 2000ms
- Catches rare dynamic stylesheet changes
- 0.5 polls/sec vs current 60 = 120x reduction

**Adaptive reset:** When the tree MutationObserver detects DOM changes (new stylesheets, script activity), the watcher resets to Tier 1 for 2 seconds. This ensures rapid changes after user interactions are caught quickly.

**Key details:**
- Uses `setTimeout` instead of `requestAnimationFrame` — no longer tied to the rendering pipeline, doesn't consume frame budget
- Change detection mechanism unchanged — `rulesChangeKey` hash comparison
- Per-stylesheet timers consolidated into a single `setTimeout` that checks all managed sheets in one pass

**Trade-off:** Stylesheet changes in Tier 3 take up to 2 seconds to detect. In practice, late stylesheet changes are almost always accompanied by DOM mutations, which trigger automatic reset to Tier 1.

**Impact:** Total `cssRules` accesses on a 20-stylesheet page drops from 1200/sec to ~10/sec at idle.

---

## Section 4: MutationObserver Consolidation

### Problem

On a page with 20 stylesheets and 5 shadow roots, Dark Reader creates ~75 MutationObservers:
- Per document root: 1 tree + 1 meta tag + 1 inline style + 1 class + 1 container + 20 per-style-element + 20 node position = 45
- Per shadow root (2 stylesheets each): 1 tree + 1 attribute + 2 per-style-element + 2 node position = 6 each, x5 = 30

Each observer has Gecko maintenance overhead, and during large DOM mutations, all observers fire callbacks independently.

### Design

Consolidate into 3 observers per root (document or shadow root):

**Observer 1 — Tree Observer (existing `createOptimizedTreeObserver`):**
- Config: `{ childList: true, subtree: true }`
- Handles: style/link element added/removed, meta tag changes, custom element registration, node position changes, container changes

**Observer 2 — Attribute Observer (new, consolidated):**
- Config: `{ attributes: true, subtree: true, attributeFilter: ['style', 'class', 'media', 'disabled', 'type'] }`
- Handles: inline style mutations, class changes for image selectors, shadow root attribute changes
- `attributeFilter` limits which attributes Gecko tracks, avoiding overhead for irrelevant attributes (`data-*`, `aria-*`)

**Observer 3 — Style Content Observer (new, consolidated):**
- Config: `{ childList: true, characterData: true, subtree: true }`
- Handles: `<style>` element text content changes
- Filters mutations by target, only forwards to relevant style manager

**Dispatch mechanism:**
- Observers 2 and 3 use a `WeakMap<Element, Handler[]>` registry to route mutations to the correct handler
- Unmatched mutations ignored (one WeakMap lookup — cheap)
- WeakMap ensures automatic cleanup when elements are removed from DOM

**Impact:** 75 observers reduced to 18 (3 per root x 6 roots). Most significant during large DOM mutations (SPA route changes) where all observers would previously fire simultaneously.

---

## Section 5: Chunked Stylesheet Processing

### Problem

`createDynamicStyleOverrides()` in `src/inject/dynamic-theme/index.ts` processes all stylesheets synchronously. On a heavy web app with 200 stylesheets, this blocks the main thread for hundreds of milliseconds — the page is unresponsive, animations freeze, and no frames are painted.

### Design

Replace the synchronous loop with a time-budgeted async processor:

**Processing loop:**
```
TARGET_FRAME_BUDGET = 12ms (leaves 4ms for browser work)

processNextBatch():
  startTime = performance.now()
  while (queue.length > 0):
    sheet = queue.shift()
    processSheet(sheet)
    if (performance.now() - startTime > TARGET_FRAME_BUDGET):
      break
  if (queue.length > 0):
    requestAnimationFrame(processNextBatch)
  else:
    onComplete()
```

This adapts automatically: simple stylesheets (few rules) allow many per frame; complex stylesheets (thousands of rules) get one per frame or are split mid-sheet.

**Priority order:**
1. **Critical (first):** `<style>` elements in `<head>` and the first `<link>` stylesheet — these contain layout and base styles affecting above-the-fold content
2. **Standard (next):** Remaining `<link>` stylesheets and `<style>` elements in document order
3. **Deferred (last):** Shadow root stylesheets for off-screen elements, adopted stylesheets on off-screen elements

Priority determined by simple heuristic: stylesheets in `<head>` are critical, stylesheets in `<body>` are standard, shadow root stylesheets are deferred unless host was in the initial DOM.

**Mutation handling during processing:**
- New `<style>` in `<head>` → insert at front of queue (critical priority)
- New `<link>` or `<style>` in `<body>` → append to queue (standard priority)
- Stylesheet removal → remove from queue if pending, remove injected styles if already processed

**Integration with Phase 1:** Phase 1 instant styles remain active throughout. Each batch's accurate styles override Phase 1 via higher specificity. On completion, Phase 1 stylesheet removed.

---

## Section 6: Inline Style Mutation Batching

### Problem

`watchForInlineStyles()` in `src/inject/dynamic-theme/inline-style.ts` processes mutations as they arrive. On reactive apps (React, Vue), a single user interaction can produce 50-100 attribute mutations. Each triggers `overrideInlineStyle()` and potentially `matchVariablesAndDependents()`.

### Design

Two-level batching:

**Level 1 — Collect:**
- MutationObserver callback adds mutated elements to a `Set<Element>` (pending set)
- `Set` automatically deduplicates — if the same element changes 5 times in one frame, it appears once

**Level 2 — Process (single rAF callback):**
- Iterate pending elements
- Apply `overrideInlineStyle()` for each
- Call `variableScheduler.markDirty()` once (not per element)
- Clear pending set

**Fast path for non-color animations:**

Most inline style mutations on dashboards are transforms, opacity, and dimensions — not colors. Skip processing entirely when no color-relevant property changed:

- Maintain a `Set` of color-related CSS properties: `color`, `background`, `background-color`, `border-color`, `outline-color`, `fill`, `stroke`, `box-shadow`, `text-shadow`, etc.
- Store last-seen `element.style.cssText` in a `WeakMap<Element, string>`
- On mutation, diff current vs stored to identify changed properties
- If no changed property is in the color set, skip that element entirely
- WeakMap ensures automatic cleanup when elements are removed

**Impact:** On a React dashboard with animated charts:
- Current: 50-100 `overrideInlineStyle()` calls + multiple `matchVariablesAndDependents()` calls per frame
- After: 5-10 `overrideInlineStyle()` calls (deduplicated, color-only) + 0 direct variable resolutions per frame (deferred to scheduler)

---

## Section 7: Cache Bounding

### Problem

Three caches grow without limit during normal operation:

| Cache | File | Growth trigger |
|-------|------|----------------|
| `parsedURLCache` | `src/utils/url.ts:9` | Every unique URL in CSS |
| `colorModificationCache` | `src/inject/dynamic-theme/modify-colors.ts:26` | Every unique color + theme settings combo |
| `imageDetailsCache` | `src/inject/dynamic-theme/modify-css.ts:307` | Every background image analyzed |

On long-lived SPAs, these accumulate thousands of entries over hours.

### Design

**parsedURLCache — cap at 512 entries:**
- Replace `new Map<string, URL>()` with `cachedFactory(parseURL, 512)` using the existing LRU utility in `src/utils/cache.ts`
- 512 is generous; most pages have <200 unique CSS URLs
- Minimal code change

**colorModificationCache — cap at 2048 entries per modifier function:**
- Replace unbounded inner `Map` with an `LRUMap` capped at 2048 entries
- 2048 covers most pages (200-500 unique colors x 3 modifier functions)
- Add theme-change awareness: clear all entries when theme parameters change, since old cache keys include theme values and become unreachable after any settings change. Without this, the LRU budget is wasted on dead entries that will never be hit again.

**imageDetailsCache — cap at 256 entries + timeout:**
- Replace with `LRUMap` capped at 256 (most pages have <50 background images)
- Add 30-second timeout for `awaitingForImageLoading` callbacks — if image loading fails silently, callbacks are cleaned up and pending callers receive `null`
- Prevents memory leak from broken URLs and CORS-blocked images

**LRU implementation:**

Extend the existing `cachedFactory` pattern into a reusable `LRUMap<K, V>` class leveraging JavaScript `Map` insertion order:
- `get()`: delete and re-insert to move to end (most recently used)
- `set()`: insert at end, evict first entry (least recently used) if over capacity
- `clear()`: used for theme-change awareness on colorModificationCache

Place in `src/utils/cache.ts` alongside the existing `cachedFactory`.

---

## Summary

| Section | Change | Primary Metric Improved |
|---------|--------|------------------------|
| 1. Two-Phase Rendering | Instant dark fallback before parsing | Eliminates white flash |
| 2. Batched Variable Resolution | Dirty flag + single rAF resolution | 10x fewer variable resolutions on init |
| 3. Firefox Sheet Watching | Tiered setTimeout polling | 120x fewer cssRules accesses at idle |
| 4. MutationObserver Consolidation | 3 observers per root + WeakMap dispatch | 75 → 18 observers |
| 5. Chunked Stylesheet Processing | Time-budgeted rAF batches | No main-thread blocking during init |
| 6. Inline Style Mutation Batching | Set dedup + color-only fast path | Skip non-color animations entirely |
| 7. Cache Bounding | LRU caps + theme-change awareness | Bounded, predictable memory on SPAs |

### Key Files Affected

| File | Sections |
|------|----------|
| `src/inject/dynamic-theme/index.ts` | 1, 2, 5 |
| `src/inject/dynamic-theme/variables.ts` | 2 |
| `src/inject/dynamic-theme/watch/sheet-changes.ts` | 3 |
| `src/inject/dynamic-theme/inline-style.ts` | 6 |
| `src/inject/dynamic-theme/modify-colors.ts` | 7 |
| `src/inject/dynamic-theme/modify-css.ts` | 7 |
| `src/inject/utils/dom.ts` | 4 |
| `src/utils/url.ts` | 7 |
| `src/utils/cache.ts` | 7 |

### Dependencies Between Sections

- Section 2 (variable batching) should be implemented before Section 6 (inline style batching), since Section 6 relies on `variableScheduler.markDirty()`
- Section 5 (chunked processing) should be implemented after Section 1 (two-phase rendering), since Phase 1 provides the fallback during chunked processing
- Sections 3, 4, and 7 are independent of each other and all other sections
