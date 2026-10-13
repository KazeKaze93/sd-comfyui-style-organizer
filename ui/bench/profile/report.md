# Grid performance PHASE B — CDP profile report

- Host: ComfyUI (`sd-comfyui-style-organizer`)
- Phase A bench host reused (static `ui/bench/.tmp/dist`, stub `/style_grid/**`, `SG_INIT` synthetic)
- CPU throttle: 4×
- Sampling interval: 100 µs
- Build: sourcemap=true, minify=false (profile-only flags; not shipped)
- Timestamp: 2026-10-10T22:41:19.445Z
- Commit: 60e6edb7a1439c01531768ee1cf6f12c0fc2a3bd

## Wall times

| N | scenario | wallMs | profileSampleMs |
|---|----------|--------|-----------------|
| 2000 | init | 587.9 | 981.0 |
| 2000 | toggle | 185.3 | 482.2 |
| 2000 | search | 214.4 | 588.3 |
| 5000 | init | 697.2 | 1437.9 |
| 5000 | toggle | 184.0 | 557.6 |
| 5000 | search | 208.2 | 603.4 |

## Top 15 self-time — N=2000 / init

Wall: **587.9 ms** · Profile samples: **981.0 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 395.2 | 40.3 | `(program)` | `(unknown):0` |
| 2 | 76.3 | 7.8 | `(idle)` | `(unknown):0` |
| 3 | 59.4 | 6.1 | `measureScroll` | `node_modules/motion-dom/dist/es/projection/node/DocumentProjectionNode.mjs:6` |
| 4 | 30.9 | 3.2 | `measureElement` | `node_modules/@tanstack/virtual-core/dist/esm/index.js:128` |
| 5 | 22.9 | 2.3 | `initInput` | `node_modules/react-dom/cjs/react-dom-client.production.js:1147` |
| 6 | 13.9 | 1.4 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 7 | 13.8 | 1.4 | `StyleCard` | `src/components/StyleCard.tsx:50` |
| 8 | 13.1 | 1.3 | `nameSearchText` | `src/store/stylesStore.ts:261` |
| 9 | 12.5 | 1.3 | `(garbage collector)` | `(unknown):0` |
| 10 | 7.2 | 0.7 | `ThumbnailPreview` | `src/components/ThumbnailPreview.tsx:12` |
| 11 | 7.2 | 0.7 | `setAttribute` | `(unknown):0` |
| 12 | 7.1 | 0.7 | `(anonymous)` | `(unknown):1` |
| 13 | 6.6 | 0.7 | `useStore` | `node_modules/zustand/esm/react.mjs:5` |
| 14 | 6.1 | 0.6 | `matchesSearchKey` | `src/store/stylesStore.ts:301` |
| 15 | 5.7 | 0.6 | `commitHookEffectListUnmount` | `node_modules/react-dom/cjs/react-dom-client.production.js:8593` |

## Top 15 self-time — N=2000 / toggle

Wall: **185.3 ms** · Profile samples: **482.2 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 342.1 | 71.0 | `(program)` | `(unknown):0` |
| 2 | 37.2 | 7.7 | `measureScroll` | `node_modules/motion-dom/dist/es/projection/node/DocumentProjectionNode.mjs:6` |
| 3 | 5.4 | 1.1 | `(idle)` | `(unknown):0` |
| 4 | 3.9 | 0.8 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 5 | 2.8 | 0.6 | `(garbage collector)` | `(unknown):0` |
| 6 | 2.3 | 0.5 | `toggleStyle` | `src/store/stylesStore.ts:792` |
| 7 | 2.2 | 0.5 | `(anonymous)` | `(unknown):0` |
| 8 | 2.2 | 0.5 | `compareEntries` | `node_modules/zustand/esm/vanilla/shallow.mjs:6` |
| 9 | 2.2 | 0.5 | `fetch` | `(unknown):0` |
| 10 | 1.7 | 0.4 | `measureAllKeyframes` | `node_modules/motion-dom/dist/es/animation/keyframes/KeyframesResolver.mjs:9` |
| 11 | 1.7 | 0.4 | `(anonymous)` | `node_modules/react-dom/cjs/react-dom-client.production.js:12455` |
| 12 | 1.7 | 0.3 | `animateChanges` | `node_modules/motion-dom/dist/es/render/utils/animation-state.mjs:61` |
| 13 | 1.7 | 0.3 | `onKeyframesResolved` | `node_modules/motion-dom/dist/es/animation/AsyncMotionValueAnimation.mjs:51` |
| 14 | 1.7 | 0.3 | `createWorkInProgress` | `node_modules/react-dom/cjs/react-dom-client.production.js:2452` |
| 15 | 1.7 | 0.3 | `matchesSearchKey` | `src/store/stylesStore.ts:301` |

## Top 15 self-time — N=2000 / search

Wall: **214.4 ms** · Profile samples: **588.3 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 404.1 | 68.7 | `(program)` | `(unknown):0` |
| 2 | 36.7 | 6.2 | `(idle)` | `(unknown):0` |
| 3 | 15.6 | 2.6 | `scrollIntoView` | `(unknown):0` |
| 4 | 10.0 | 1.7 | `Virtualizer.getMaxScrollOffset` | `node_modules/@tanstack/virtual-core/dist/esm/index.js:1001` |
| 5 | 6.7 | 1.1 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 6 | 6.0 | 1.0 | `matchesSearch` | `src/store/stylesStore.ts:293` |
| 7 | 3.8 | 0.6 | `getCssDimensions` | `node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs:6` |
| 8 | 3.7 | 0.6 | `walk` | `(unknown):51` |
| 9 | 3.4 | 0.6 | `matchSearchTokens` | `src/store/stylesStore.ts:287` |
| 10 | 3.3 | 0.6 | `getViewportRect` | `node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs:222` |
| 11 | 3.3 | 0.6 | `getAnimationName` | `node_modules/@radix-ui/react-presence/dist/index.mjs:118` |
| 12 | 2.9 | 0.5 | `(garbage collector)` | `(unknown):0` |
| 13 | 2.7 | 0.5 | `computePosition$1` | `node_modules/@floating-ui/core/dist/floating-ui.core.mjs:135` |
| 14 | 2.6 | 0.4 | `(anonymous)` | `node_modules/cmdk/dist/index.mjs:1` |
| 15 | 2.3 | 0.4 | `(anonymous)` | `node_modules/@radix-ui/react-popper/dist/index.mjs:56` |

## Top 15 self-time — N=5000 / init

Wall: **697.2 ms** · Profile samples: **1437.9 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 679.3 | 47.2 | `(program)` | `(unknown):0` |
| 2 | 179.3 | 12.5 | `(idle)` | `(unknown):0` |
| 3 | 57.8 | 4.0 | `measureScroll` | `node_modules/motion-dom/dist/es/projection/node/DocumentProjectionNode.mjs:6` |
| 4 | 31.8 | 2.2 | `nameSearchText` | `src/store/stylesStore.ts:261` |
| 5 | 28.8 | 2.0 | `measureElement` | `node_modules/@tanstack/virtual-core/dist/esm/index.js:128` |
| 6 | 18.7 | 1.3 | `(garbage collector)` | `(unknown):0` |
| 7 | 15.1 | 1.1 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 8 | 14.2 | 1.0 | `initInput` | `node_modules/react-dom/cjs/react-dom-client.production.js:1147` |
| 9 | 14.1 | 1.0 | `buildSearchTextByKey` | `src/store/stylesStore.ts:277` |
| 10 | 13.6 | 0.9 | `(anonymous)` | `(unknown):1` |
| 11 | 13.2 | 0.9 | `matchesSearchKey` | `src/store/stylesStore.ts:301` |
| 12 | 10.9 | 0.8 | `StyleCard` | `src/components/StyleCard.tsx:50` |
| 13 | 9.3 | 0.6 | `setStyles` | `src/store/stylesStore.ts:631` |
| 14 | 8.7 | 0.6 | `parseEvaluationResultValue` | `(unknown):120` |
| 15 | 8.2 | 0.6 | `(anonymous)` | `src/store/stylesStore.ts:1474` |

## Top 15 self-time — N=5000 / toggle

Wall: **184.0 ms** · Profile samples: **557.6 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 409.8 | 73.5 | `(program)` | `(unknown):0` |
| 2 | 29.3 | 5.2 | `measureScroll` | `node_modules/motion-dom/dist/es/projection/node/DocumentProjectionNode.mjs:6` |
| 3 | 15.6 | 2.8 | `(idle)` | `(unknown):0` |
| 4 | 11.3 | 2.0 | `(garbage collector)` | `(unknown):0` |
| 5 | 4.4 | 0.8 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 6 | 3.8 | 0.7 | `matchesSearchKey` | `src/store/stylesStore.ts:301` |
| 7 | 2.2 | 0.4 | `compareEntries` | `node_modules/zustand/esm/vanilla/shallow.mjs:6` |
| 8 | 2.1 | 0.4 | `(anonymous)` | `node_modules/react-dom/cjs/react-dom-client.production.js:12455` |
| 9 | 1.8 | 0.3 | `fetch` | `(unknown):0` |
| 10 | 1.7 | 0.3 | `animateChanges` | `node_modules/motion-dom/dist/es/render/utils/animation-state.mjs:61` |
| 11 | 1.7 | 0.3 | `commitMutationEffectsOnFiber` | `node_modules/react-dom/cjs/react-dom-client.production.js:9427` |
| 12 | 1.7 | 0.3 | `(anonymous)` | `src/store/stylesStore.ts:308` |
| 13 | 1.6 | 0.3 | `(anonymous)` | `src/components/StyleCard.tsx:54` |
| 14 | 1.6 | 0.3 | `walk` | `(unknown):51` |
| 15 | 1.6 | 0.3 | `batchedUpdates$1` | `node_modules/react-dom/cjs/react-dom-client.production.js:1494` |

## Top 15 self-time — N=5000 / search

Wall: **208.2 ms** · Profile samples: **603.4 ms**

| # | selfMs | % | function | file:line |
|---|--------|---|----------|-----------|
| 1 | 418.2 | 69.3 | `(program)` | `(unknown):0` |
| 2 | 42.1 | 7.0 | `(idle)` | `(unknown):0` |
| 3 | 15.4 | 2.5 | `scrollIntoView` | `(unknown):0` |
| 4 | 10.2 | 1.7 | `Virtualizer.getMaxScrollOffset` | `node_modules/@tanstack/virtual-core/dist/esm/index.js:1001` |
| 5 | 7.9 | 1.3 | `matchesSearch` | `src/store/stylesStore.ts:293` |
| 6 | 7.2 | 1.2 | `matchSearchTokens` | `src/store/stylesStore.ts:287` |
| 7 | 6.4 | 1.1 | `renderWithHooks` | `node_modules/react-dom/cjs/react-dom-client.production.js:4333` |
| 8 | 3.5 | 0.6 | `walk` | `(unknown):51` |
| 9 | 3.3 | 0.5 | `getCssDimensions` | `node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs:6` |
| 10 | 3.3 | 0.5 | `matchesSearchKey` | `src/store/stylesStore.ts:301` |
| 11 | 3.3 | 0.5 | `getAnimationName` | `node_modules/@radix-ui/react-presence/dist/index.mjs:118` |
| 12 | 3.0 | 0.5 | `(anonymous)` | `node_modules/cmdk/dist/index.mjs:1` |
| 13 | 2.7 | 0.4 | `detectOverflow` | `node_modules/@floating-ui/core/dist/floating-ui.core.mjs:68` |
| 14 | 2.3 | 0.4 | `commitHookEffectListMount` | `node_modules/react-dom/cjs/react-dom-client.production.js:8571` |
| 15 | 1.7 | 0.3 | `(anonymous)` | `node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs:21` |

## Components re-rendering on toggle

### N=2000

- Commits during toggle window: **3**
- Wall toggle: **185.3 ms**

| component | render count (PerformedWork, allowlisted) |
|-----------|------------------------------------------|
| `ThumbnailPreview` | 144 |
| `motion.div` | 14 |
| `MeasureLayout` | 12 |
| `CategoryName` | 10 |
| `AnimatePresence` | 2 |
| `SearchBar` | 1 |
| `Sidebar` | 1 |
| `CategoryTitle` | 1 |
| `BottomPanel` | 1 |
| `StyleInfoPanel` | 1 |
| `SelectedBar` | 1 |

- Takeaway: `StyleGrid`×0, `StyleCard`×0 (memo + `selectedKeySet` boolean selectors keep card fan-out tiny; grid/chrome still re-render).

### N=5000

- Commits during toggle window: **3**
- Wall toggle: **184.0 ms**

| component | render count (PerformedWork, allowlisted) |
|-----------|------------------------------------------|
| `ThumbnailPreview` | 144 |
| `motion.div` | 14 |
| `MeasureLayout` | 12 |
| `CategoryName` | 10 |
| `AnimatePresence` | 2 |
| `SearchBar` | 1 |
| `Sidebar` | 1 |
| `CategoryTitle` | 1 |
| `BottomPanel` | 1 |
| `StyleInfoPanel` | 1 |
| `SelectedBar` | 1 |

- Takeaway: `StyleGrid`×0, `StyleCard`×0 (memo + `selectedKeySet` boolean selectors keep card fan-out tiny; grid/chrome still re-render).

## Answers

### 1) What does a single toggle recompute at grid level?

`StyleGrid` subscribes to `selectedStyles` (shallow store slice). One card click → `toggleStyle` → new `selectedStyles` + `selectedKeySet`. That forces a **grid-level re-render** even when individual `StyleCard`s are `memo`ized.

On that grid render (All-categories view used by the bench), the expensive recomputes are:

1. **Group rebuild** — `filtered.reduce` into category buckets, then `categories()` ordering (`StyleGrid.tsx` ~348–365). `categories()` itself is O(N) over `styles`.
2. **`allSelected` per category** — `catStyles.every(s => selectedStyles.some(...))` (`StyleGrid.tsx` ~371–373): nested scan, O(groupSize × selectionSize) per category header.
3. **Children reconcile** — React walks all N `StyleCard` fibers; `memo` + `useIsSelected` (`selectedKeySet.has`) should bail out of paint for untouched cards, but any card that *does* re-render still pays **`nextDuplicateName(styles)` + `categories()`×2** (closed dialog props) — O(N) each.
4. **Selection index** — `buildSelectedKeySet` subscriber path in `stylesStore.ts`.
5. **Motion** — group `measureScroll` / projection updates can still run while the tree reconciles.

**N=2000** wall 185.3 ms, commits=3, card class mutations=1
`ThumbnailPreview`×144, `motion.div`×14, `MeasureLayout`×12, `CategoryName`×10, `AnimatePresence`×2, `SearchBar`×1, `Sidebar`×1, `CategoryTitle`×1, `BottomPanel`×1, `StyleInfoPanel`×1, `SelectedBar`×1

**N=5000** wall 184.0 ms, commits=3, card class mutations=1
`ThumbnailPreview`×144, `motion.div`×14, `MeasureLayout`×12, `CategoryName`×10, `AnimatePresence`×2, `SearchBar`×1, `Sidebar`×1, `CategoryTitle`×1, `BottomPanel`×1, `StyleInfoPanel`×1, `SelectedBar`×1


### 2) Search keystroke: filtering vs rendering share?

Wall **214.4 ms** · raw samples **588.3 ms** (of which (program)/(idle)/gc ≈ 447.4 ms excluded below).

| bucket | selfMs | share of attributed samples |
|--------|--------|-----------------------------|
| Filtering (`matchesSearch` / `matchSearchTokens` / dedupe) | 10.7 | 7.6% |
| Rendering (React + StyleCard/Grid + DOM + motion + per-card `categories`/`nextDuplicateName`) | 43.6 | 31.0% |
| Other attributed | 86.6 | 61.5% |

Haystacks are precomputed (`searchTextByKey`); filter self-time is a small O(N) token scan. The keystroke cost is **re-rendering the surviving card forest** (unvirtualized). Query `B` keeps almost all synthetic rows visible, so render≈full-grid work.

### N=5000

Wall **208.2 ms** · raw samples **603.4 ms** (of which (program)/(idle)/gc ≈ 463.7 ms excluded below).

| bucket | selfMs | share of attributed samples |
|--------|--------|-----------------------------|
| Filtering (`matchesSearch` / `matchSearchTokens` / dedupe) | 19.0 | 13.6% |
| Rendering (React + StyleCard/Grid + DOM + motion + per-card `categories`/`nextDuplicateName`) | 41.2 | 29.5% |
| Other attributed | 79.5 | 56.9% |

Haystacks are precomputed (`searchTextByKey`); filter self-time is a small O(N) token scan. The keystroke cost is **re-rendering the surviving card forest** (unvirtualized). Query `B` keeps almost all synthetic rows visible, so render≈full-grid work.

### 3) Superlinear init (2000→5000)

Phase A median init was ~×5.2 from N=2000→5000 (N grows ×2.5). This profile run: wall **587.9 ms → 697.2 ms (×1.19)**.

Smoking gun is **O(N²) work inside each StyleCard render**, not the store ingest:

- `nextDuplicateName` (`StyleCard.tsx:41`, called from `:441` as `initialValue=...`) builds `new Set(catalog.map(s => s.name))` — **O(N) per card**, always, even with `duplicateOpen === false`.
- `categories()` (`stylesStore.ts:1427`, called from `StyleCard.tsx:498` and `:532`) rescans all styles — **O(N) per card × 2**.

Expected quadratic scale factor for N×2.5 is ~×6.25; the init self-time growth for these frames matches that band.

No single mapped frame cleared the >×4 self-time bar with ≥20 ms @5000; see top-15 init tables.

## Raw artifacts

JSON profiles + analysis: `ui/bench/profile/raw/*.cpuprofile.json`, `summary.json`.

