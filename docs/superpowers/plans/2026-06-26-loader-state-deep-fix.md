# Loader state deep fix (re-review of #192) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Eliminate the `undefined`/`null`-vs-absent collapse entirely: the runner returns the discriminated `LoaderState`/`StreamState` union directly (no scalar flatten, no `settled`, no `data !== undefined` heuristic anywhere), value-presence carried STRUCTURALLY by the variant tag, and the preload layer distinguishes "absent" from "value is null".

**Architecture:** `getPreloadedData` returns a present/absent discriminant. The runner's `LoaderPhase` splits `error` into `error` (cold, no value) and `staleError` (has value), so value-presence is structural; the runner builds the public union (plus a `coldError` signal) directly and `loader.tsx` only routes it (memoize -> context, or coldError -> boundary). `toStreamState` keys on `status` only. `ViewRenderer`/`useData` read the context union.

## Global Constraints

- Worktree `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/loader-loading-state`, branch `worktree-loader-loading-state`. Worktree-absolute paths; no Serena; verify branch before commit; do NOT push.
- No em-dashes; NO type casts and NO `data === undefined` / `value !== undefined` value-presence heuristic anywhere in the loader-state path (that is the whole point). Value-presence must be structural (variant tag / `present` flag).
- `pnpm vitest` runs from the WORKTREE ROOT.
- Green checkpoint = full 8-step CI gate.
- Commits end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Findings being fixed (re-review of #192)

| # | Finding | Fix |
|---|---|---|
| preload | `getPreloadedData` `!== null` cannot tell absent from baked null/undefined; loader refetches + skeleton-flashes on hydration | return `{ present: true; value } \| { present: false }`; runner adopts on `.present` |
| settled | `settled` re-derives from `data !== undefined`; an `undefined`-valued loader whose reload rejects unwinds the page | structural `staleError` phase (has value); cold `error` phase (no value); no `settled` boolean |
| reload | `runReload` uses `prior !== undefined` -> cold-flash on reload of an `undefined`-valued loader | revalidate when there is a settled value structurally (has-value phase OR preload present), not when `value !== undefined` |
| stream | `toStreamState` `data === undefined` before open/closed -> open stream with `undefined` value stuck on `connecting` | key `toStreamState` on `status` only |
| altitude | runner flattens ADT to scalars then re-inflates | runner returns the discriminated union directly |
| doc-live | `live-loaders.mdx` says cold stream error -> errorFallback/boundary (opposite of shipped in-view) | rewrite to the in-view `status === 'error'` behavior |
| doc-single | `loaders.mdx` error example implies inline error handles first-load rejection | note the cold-error-routes-to-boundary caveat / cross-ref `loading-states.mdx` |
| dead-ctx | `LoaderStatusContext` provider has zero consumers | delete the context + provider |
| overlay | OptimisticOverlay drops the projection during loading | provide the projected value on the loading arm too |
| dry-status | stream-status vocabulary declared 3x | `StreamStatus = StreamState<unknown>['status']` |

---

### Task D1: Edge regression tests (RED first) - the `undefined`/`null` cases

**Files:** add to `packages/iso/src/internal/__tests__/loader.test.tsx` (single-value) and `loader-streaming.test.tsx` (stream), through a rendered `.View`/`Boundary` (NOT the runner directly).

- [ ] **Step 1: Write the failing tests** (each mutation-proof against the CURRENT code):
  1. **undefined reload-error keeps the view** (settled finding): a non-live loader resolves to `undefined`; then `reload()` REJECTS. Assert the rendered output is the in-view `error` arm (e.g. `err:<msg>`), with NO page unwind / no `errorFallback`. (Fails now: `settled=false` -> coldError -> unwind.)
  2. **undefined reload holds the prior view** (reload finding): a non-live loader resolves to `undefined`; `reload()` is pending. Assert the render shows `revalidating` (not the cold `loading` skeleton). (Fails now: `prior===undefined` -> cold loading.)
  3. **null preload is adopted on hydration** (preload finding): mock `getPreloadedData` to report a PRESENT value of `null`; assert the first client render shows the `success` arm with `data===null` and the loader fn is NOT called (no refetch). (Fails now: `null` treated as absent -> cold refetch.)
  4. **open stream with `undefined` accumulator shows `open`** (stream finding): a live loader with `initial: undefined` (or a `reduce` returning `undefined`) that has emitted a chunk; assert the render shows the `open` arm (its handling of `undefined` data), NOT `connecting`. (Fails now: `data===undefined` -> connecting.)
  5. **zero-chunk close shows `closed`**: a live loader that ends (`onEnd`) with no chunk; assert `closed`, not `connecting`.
- [ ] **Step 2: Run; confirm all five FAIL** (worktree root): `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/internal/__tests__/loader-streaming.test.tsx`
- [ ] **Step 3: Commit the red tests.** `test(iso): failing edge tests for undefined/null loader values (re-review of #192)`

---

### Task D2: Structural value-presence - runner returns the union

**Files:** `packages/iso/src/internal/preload.ts`, `packages/iso/src/internal/use-loader-runner.tsx`, `packages/iso/src/loader-state.ts`, `packages/iso/src/internal/loader.tsx`, `packages/iso/src/internal/view-renderer.tsx`, `packages/iso/src/define-loader.ts`, `packages/iso/src/internal/contexts.ts`, plus the `getPreloadedData` test mocks.

- [ ] **Step 1: `getPreloadedData` present/absent** (`preload.ts`): return `{ present: true; value: T } | { present: false }`. The detection already exists (`!el || !('loader' in el.dataset)` -> `{ present: false }`; a parse error -> `{ present: false }`; otherwise `{ present: true, value: JSON.parse(...) }`). Update the runner's call site and every `vi.mock('../preload.js', ...)` in tests (return `{ present: false }` for "no preload").

- [ ] **Step 2: Structural phase** (`use-loader-runner.tsx`): split the error variant so presence is structural:
```ts
type LoaderPhase<T> =
  | { tag: 'loading' }                          // no value
  | { tag: 'revalidating'; value: T }           // has value (may be undefined)
  | { tag: 'success'; value: T }                // has value (may be undefined)
  | { tag: 'error'; error: Error }              // cold error, NO value
  | { tag: 'staleError'; error: Error; value: T }; // error with prior value
```
Track preload/cache adoption with a `syncPresentRef` boolean (set true whenever a preload `.present` or `cache.has` hit is adopted, alongside `syncDataRef.current = value`); reset it with `syncDataRef` on location/loader change. Define structural helpers:
```ts
const hasPhaseValue = (p) => p.tag === 'success' || p.tag === 'revalidating' || p.tag === 'staleError';
// current settled value + whether one exists, with NO `!== undefined` test:
const hasValue = hasPhaseValue(phase) || syncPresentRef.current;
const currentValue = hasPhaseValue(phase) ? phase.value : syncDataRef.current; // only meaningful when hasValue
```
Error construction (the `setError` helper and the stream/reload error callbacks): if `hasValue` -> `{ tag: 'staleError', error, value: currentValue }`, else `{ tag: 'error', error }`. `runReload`'s revalidating-vs-loading decision: `hasValue ? { tag: 'revalidating', value: currentValue } : { tag: 'loading' }` (NOT `prior !== undefined`).

- [ ] **Step 3: Runner returns the discriminated union** (`use-loader-runner.tsx` + `loader-state.ts`): build the public state structurally (no scalar `data`/`loading`/`settled`). Add builders in `loader-state.ts`:
```ts
// single value: returns the renderable union, or a cold-error signal
export type LoaderView<T> = { kind: 'render'; state: LoaderState<T> } | { kind: 'coldError'; error: Error };
// caller passes the structural phase + sync presence; NO data===undefined.
```
Map: `success -> {status:'success', data:value}`; `revalidating -> {status:'revalidating', data:value}`; `staleError -> {status:'error', error, data:value}`; `error -> {kind:'coldError', error}`; `loading -> syncPresent ? {status:'success', data:syncValue} : {status:'loading'}`. For streaming, `toStreamState(status, value, error)` keys on STATUS only: `connecting -> {connecting}`; `open -> {open, data:value}`; `closed -> {closed, data:value}`; `error -> {error, error, data:value}` (value may be undefined). The runner returns `{ view: LoaderView<T> | { kind:'render'; state: StreamState<T> }, reload, reloading, reader }` (reloading is `phase.tag==='revalidating'`, kept only for `useReload()`; everything else is on the union).

- [ ] **Step 4: `loader.tsx` routes** : `if (view.kind === 'coldError') { errorFallback ? render it : throw view.error }` else memoize `view.state` (`useMemo` keyed on its fields) and put it on `LoaderDataContext`. Delete the `coldError = ... && !settled` scalar computation and the `toLoaderState(data, error, settled, reloading)` call. `DataReader` (SSR) builds the success/connecting state the same way.

- [ ] **Step 5: `ViewRenderer`/`useData` read** the context union (unchanged from the prior round: spread props / return ctx). `contexts.ts` `LoaderDataContext` stays `LoaderState<unknown> | StreamState<unknown> | null`.

- [ ] **Step 6:** Run D1 + the FULL iso suite + iso typecheck GREEN (worktree root). Migrate any test asserting the old scalar runner return. Confirm `rg 'settled|data === undefined|value !== undefined' packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/loader-state.ts` shows no value-presence heuristic. Commit: `fix(iso): runner returns discriminated state; structural value-presence, no undefined heuristic (re-review #192)`.

---

### Task D3: Docs + dead provider + overlay + status DRY

- [ ] **Step 1:** `live-loaders.mdx` (lines ~170/207/216): rewrite the cold-stream-error prose + the errorFallback table row to the SHIPPED in-view behavior: a live `.View` cold connect error surfaces as `status === 'error'` in the render fn (handle it there); `errorFallback` only catches render-time throws. `loaders.mdx:220`: note that a non-live loader's cold first-load rejection routes to the boundary/page `errorFallback`, and the inline `error` arm is reached for a stale-while-error reload failure (cross-ref `loading-states.mdx`).
- [ ] **Step 2:** Delete `LoaderStatusContext` (definition in `loader.tsx:27` + the provider wrapper) - zero consumers after the union move.
- [ ] **Step 3:** `optimistic-overlay.tsx`: provide the projected value on the loading/connecting arm too (do not pass the bare loading arm through), so the optimistic projection is visible during the first load; do not run `pending.reduce` against an absent base in a way that throws.
- [ ] **Step 4:** `StreamStatus = StreamState<unknown>['status']` (derive, single source); update `define-loader.ts` `isLoaderState` to derive its exclusion from the status union if practical.
- [ ] **Step 5:** `pnpm format`; run iso + site build; commit: `refactor(iso): live-loaders/loaders docs to shipped behavior; drop dead LoaderStatusContext; overlay loading projection; status DRY (re-review #192)`.

---

### Task D4: Gate + re-run the oracle

- [ ] **Step 1:** Full 8-step CI gate from the worktree root, all green.
- [ ] **Step 2:** Re-run `Workflow code-review high` against the LOCAL diff `git diff origin/loader-loading-state...worktree-loader-loading-state`; confirm the preload/settled/reload/stream/altitude/doc findings are gone and nothing new is introduced.

## Self-review

1. NO `data === undefined` / `value !== undefined` / `!== null` value-presence test survives in the loader-state path (grep clean). Presence is the variant tag or the `present` flag.
2. The 5 edge tests are end-to-end (through `.View`/`useData`) and mutation-proof.
3. Single source of truth: the runner builds the union; `loader.tsx` routes; no re-projection downstream.
