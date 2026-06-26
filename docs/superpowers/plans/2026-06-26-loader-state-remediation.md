# Loader state ADT remediation (high-effort review of #192) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the correctness regressions the high-effort review of PR #192 found: the discriminated state must be authoritative end-to-end (carried on context, projected once from the discriminant), not flattened to `{data, loading}` and heuristically re-projected.

**Architecture:** The runner keeps its `LoaderPhase` ADT and exposes a `settled` discriminant; `loader.tsx` projects to the public `LoaderState`/`StreamState` union ONCE (memoized) and puts it on `LoaderDataContext`; `ViewRenderer` and `useData()` read the union directly (no re-projection). Cold single-value errors still route to the boundary; cold stream errors surface in-view via a reachable `StreamState.error` arm.

**Tech stack:** TypeScript, Preact + preact/hooks, Vitest + @testing-library/preact (happy-dom).

## Global Constraints

- Worktree `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/loader-loading-state`, branch `worktree-loader-loading-state` (PR #192 head `loader-state-adt`). Worktree-absolute paths; no Serena; verify branch before commit; do not push.
- No em-dashes anywhere (code, comments, **prose/plan/spec docs**, commit messages). No type casts (this work REMOVES the last `accumulate.initial as T`).
- `pnpm vitest` runs from the WORKTREE ROOT (root config uses repo-root-relative globs); `pnpm vitest run <path>` for a file, `pnpm vitest --typecheck run <path>` for `*.test-d.ts`.
- Green checkpoint = full 8-step CI gate (build, gen:agents-corpus, format:check, typecheck, test:types, test:coverage, test:integration, site build).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Findings being fixed

| # | Finding | Resolution |
|---|---|---|
| 1 | `toLoaderState` collapses settled-`undefined` to `loading` (loading-forever) | project from the `settled` discriminant, not `data === undefined` |
| 2 | reload-over-preload never enters `revalidating` (no feedback) | `runReload` reads the synchronous preload/cache value as the prior |
| 3 | settled-`undefined` falls back to stale `syncDataRef` value | `data = phase.tag === 'loading' ? syncDataRef.current : phaseValue(phase)` |
| 5 | cold live-stream error unwinds the whole page | reachable `StreamState.error` arm (data optional); coldError is single-value only |
| 6 | flatten-then-reproject round-trip (altitude) | project once in `loader.tsx`; context carries the union |
| 7 | `useData()` returns a fresh object every render | memoize the context union |
| 8 | error-phase construction copy-pasted 8x | one `setError(err)` helper |
| cast | `accumulate.initial as T` still ships (`use-loader-runner.tsx:197`) | reshape: carry prior `phaseValue` / don't surface the seed as a phase value |
| docs | em-dashes in plan/spec prose | strip them |

---

### Task R1: End-to-end regression tests (RED first)

**Files:** add to `packages/iso/src/internal/__tests__/loader.test.tsx` (or `packages/iso/src/__tests__/loader-view.test.tsx`), use the file's existing `.View`/`Boundary` end-to-end render harness (renders a `.View` component and asserts the rendered DOM). These tests must go through `.View`/`useData`, NOT the runner directly.

**Interfaces produced:** none (tests only).

- [ ] **Step 1: Write the failing end-to-end tests**

Write these four tests (real assertions through the rendered `.View`; reuse the harness in the file):

1. **#1 settled-undefined renders `success`, not loading-forever.** A non-live loader whose fn resolves to `undefined`. Render its `.View` with `(s) => s.status === 'loading' ? <p>loading</p> : <p>done:{String(s.data)}</p>`. After the loader resolves, assert the DOM shows `done:undefined` (the `success` arm), NOT `loading`. (Mutation-check: fails on current `toLoaderState` which returns `{status:'loading'}` for `data===undefined`.)
2. **#2 reload-over-preload enters `revalidating`.** A loader hydrated from an SSR preload (use the file's preload stub: `getPreloadedData` mock returns a value), rendered via `.View` with a render fn that shows `reval` for `status==='revalidating'` and the data otherwise, plus a button calling `useReload().reload()`. Click reload (with the next fetch pending); assert the DOM shows `reval` AND still shows the prior data. (Mutation-check: fails on current code, which enters cold `loading`/`success` so `revalidating` never renders.)
3. **#3 undefined-update over preload shows undefined, not stale.** Loader hydrated from preload value `V`; trigger a reload whose fetch resolves to `undefined`; assert the rendered data is the new `undefined` (e.g. `done:undefined`), not stale `V`. (Mutation-check: fails on current `data = settledValue !== undefined ? settledValue : syncDataRef.current`.)
4. **#7 `useData()` is referentially stable.** Inside a `.Boundary`, capture `useData()` across two renders with unchanged loader state (force a parent re-render via unrelated state); assert `Object.is(first, second)` is true. (Mutation-check: fails on current `useData()` returning a fresh `toLoaderState(...)` each render.)

- [ ] **Step 2: Run to verify all four FAIL**

Run (from worktree root): `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx`
Expected: the four new tests FAIL against current code (the rest stay green).

- [ ] **Step 3: Commit the red tests**

```bash
git add packages/iso/src/internal/__tests__/loader.test.tsx
git commit -m "test(iso): failing end-to-end regression tests for loader-state review (#1,#2,#3,#7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task R2: Authoritative discriminated state, projected once on context

**Files:**
- Modify: `packages/iso/src/internal/use-loader-runner.tsx` (data derivation, `settled`, `runReload` prior)
- Modify: `packages/iso/src/internal/contexts.ts` (`LoaderDataContext` carries the union)
- Modify: `packages/iso/src/internal/loader.tsx` (project once, memoize, coldError single-value only)
- Modify: `packages/iso/src/internal/view-renderer.tsx` (read union, do not project)
- Modify: `packages/iso/src/define-loader.ts` (`useData()` reads union, no project)
- Modify: `packages/iso/src/loader-state.ts` (`toLoaderState` takes the discriminant)

**Interfaces produced:**
- runner `LoaderRunnerState<T>` gains `settled: boolean` (a settled value exists: phase is success/revalidating/error-with-value, OR a synchronous preload/cache value is present).
- `LoaderDataContext` carries `LoaderState<unknown> | StreamState<unknown>` (the projected union), replacing `{ data: unknown; loading: boolean }`.
- `toLoaderState(data, error, settled, reloading): LoaderState<T>`, projects from the discriminant, never from `data === undefined`.

- [ ] **Step 1: Runner, authoritative `data` + `settled`**

In `use-loader-runner.tsx`, replace the derivation (currently ~lines 465-480):
```ts
  // Settled phases (success/revalidating/error) own the value, even when it is
  // `undefined` (a real resolve-to-undefined); only the synchronous preload/cache
  // path leaves `phase` at `loading` while a value is available via syncDataRef.
  const data =
    phase.tag === 'loading' ? syncDataRef.current : phaseValue(phase);
  const settled = phase.tag !== 'loading' || syncDataRef.current !== undefined;
  const reloading = phase.tag === 'revalidating';
  const error = phase.tag === 'error' ? phase.error : null;
  const loading = reloading || (inFlightRef.current && !settled && error === null);
```
Return `settled` alongside the existing fields.

- [ ] **Step 2: Runner, `runReload` retains the preload/cache value (#2)**

Replace the `runReload` opening `setPhase` (currently ~lines 184-189) so the prior value includes the synchronous value:
```ts
    setPhase((p) => {
      const prior = p.tag === 'loading' ? syncDataRef.current : phaseValue(p);
      return prior !== undefined
        ? { tag: 'revalidating', value: prior }
        : { tag: 'loading' };
    });
```

- [ ] **Step 3: `LoaderDataContext` carries the union**

In `contexts.ts`:
```ts
import type { LoaderState, StreamState } from '../loader-state.js';
export const LoaderDataContext = createContext<
  LoaderState<unknown> | StreamState<unknown> | null
>(null);
```

- [ ] **Step 4: `toLoaderState` projects from the discriminant**

In `loader-state.ts`, change `toLoaderState` to take the discriminant (drop the `data === undefined -> loading` heuristic):
```ts
export function toLoaderState<T>(
  data: T | undefined,
  error: Error | null,
  settled: boolean,
  reloading: boolean
): LoaderState<T> {
  if (error !== null && settled) return { status: 'error', error, data: data as T };
  if (!settled) return { status: 'loading' };
  if (reloading) return { status: 'revalidating', data: data as T };
  return { status: 'success', data: data as T };
}
```
NOTE on the `data as T`: the union arms type `data: T`, but `data` here is `T | undefined` and `settled` guarantees it is the settled value (which MAY legitimately be `undefined` when `T` includes `undefined`). Reshape to avoid the cast: type the value carrier so the arm's `data` is `T` where `T` already admits the settled value, i.e. the projection's `data` parameter should be `T` (the caller passes the settled value, whose type already includes `undefined` when the loader can return it). Pass `data` typed as `T` from `loader.tsx` (the runner's `data` is `T | undefined` only because of the cold arm; in the `settled` branch it is `T`). If a clean reshape is not reachable, prefer a single documented boundary, but try the reshape first (Global Constraint).

- [ ] **Step 5: `loader.tsx` projects once + memoizes (fixes #6, #7) + coldError single-value only (#5 prep)**

In `LoaderHost`, after destructuring the runner (now including `settled`):
```ts
  const viewState = useMemo(
    () =>
      accumulate
        ? toStreamState(data, status, error)
        : toLoaderState(data as T, error, settled, reloading),
    [accumulate, data, status, error, settled, reloading]
  );
```
Put `viewState` on `LoaderDataContext.Provider value={viewState}` in BOTH the client branch and `DataReader` (server projects `toLoaderState(resolvedValue, null, true, false)` / `toStreamState(...)`). Change `coldError` to single-value only: `const coldError = !accumulate && error != null && !settled;` (a cold stream error now flows to the `StreamState.error` arm instead of the boundary).

- [ ] **Step 6: `ViewRenderer` + `useData()` read, do not project**

`view-renderer.tsx`: replace the `toLoaderState`/`toStreamState` call with a direct read:
```ts
  const state = useContext(LoaderDataContext);
  // state is non-null inside a Loader; spread consumer props last.
  return render({ ...(state as object), ...props } as ViewState);
```
`define-loader.ts` `useData()`: return the context union directly (it is already a `LoaderState` for a non-live loader):
```ts
  const ctx = useContext(LoaderDataContext);
  if (!ctx) throw new Error('loader.useData() must be called inside a `loader.View` render function or inside a `loader.Boundary`.');
  return ctx as LoaderState<Serialize<T>>;
```

- [ ] **Step 7: Run R1 + the full iso suite to GREEN**

Run (worktree root): `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx` (R1 tests now pass), then `pnpm vitest run` (full iso) and `pnpm vitest --typecheck run`. Migrate any iso test that read `LoaderDataContext` as `{data, loading}` to the new union shape; do not weaken assertions.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src
git commit -m "fix(iso): carry discriminated loader state on context, project once (review #1,#2,#3,#6,#7)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task R3: Cold stream errors surface in-view (#5)

**Files:** `packages/iso/src/loader-state.ts` (`StreamState`, `toStreamState`), `apps/site/src/components/demo/ActivityBar.tsx`, `apps/site/src/pages/demo/live-tally.tsx`, `apps/example-node/src/pages/home.tsx`, the two scaffold templates if they have a live `.View`; test in `loader-streaming.test.tsx`.

- [ ] **Step 1: Failing test**, a live loader whose connect rejects BEFORE the first chunk renders the `StreamState.error` arm in-view (no throw to an outer boundary). Confirm it fails (currently `coldError` throws).
- [ ] **Step 2:** `StreamState` error arm carries optional data: `{ status: 'error'; error: Error; data?: T }`. Reorder `toStreamState` so error wins: `if (error !== null) return { status: 'error', error, data }; if (status === 'connecting' || data === undefined) return { status: 'connecting' }; if (status === 'closed') return { status: 'closed', data }; return { status: 'open', data };`
- [ ] **Step 3:** Every live consumer's render fn must handle `status === 'error'` (render an error/retry affordance) and must NOT deref `s.data` outside `open`/`closed`. Update ActivityBar/Feed, live-tally, LiveCounter, templates.
- [ ] **Step 4:** Run the streaming + app suites + the SSR guard; commit.

```bash
git commit -m "fix(iso): cold stream errors surface in the StreamState error arm, not the page boundary (review #5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task R4: Cleanups (#8, cast, em-dashes)

- [ ] **Step 1: `setError` helper** in `use-loader-runner.tsx`: `const setError = (err: unknown) => setPhase((p) => ({ tag: 'error', error: err instanceof Error ? err : new Error(String(err)), value: phaseValue(p) }));` Replace the 8 copy-pasted error-phase constructions (and the 4 inline `instanceof Error` normalizations) with `setError(err)`. Run the runner suite.
- [ ] **Step 2: Drop the `accumulate.initial as T` cast** at the streaming `runReload` (`use-loader-runner.tsx:197`): carry the prior `phaseValue(p)` (or leave the surfaced value undefined so the connecting arm shows) instead of casting the seed; the seed stays the internal `reduce` start (`accRef.current`), never a phase value. Confirm no `accumulate.initial as T` remains and streaming tests pass.
- [ ] **Step 3: Strip em-dashes** from `docs/superpowers/plans/2026-06-25-loader-state-adt.md`, `docs/superpowers/specs/2026-06-25-loader-state-adt-design.md`, and this file if any crept in: `rg -l '-' docs/superpowers` then replace each with a comma/semicolon/colon/parentheses. Verify `rg '-' docs/superpowers` is empty.
- [ ] **Step 4: `pnpm format`, then commit.**

```bash
git commit -m "refactor(iso): setError helper, drop accumulate.initial cast; strip plan/spec em-dashes (review #8,cast,docs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task R5: Gate + re-run the high-effort review

- [ ] **Step 1:** Full 8-step CI gate from the worktree root (build, gen:agents-corpus, format:check, typecheck, test:types, test:coverage, test:integration, site build). Fix and re-run until all green.
- [ ] **Step 2:** Push the branch (updates PR #192), then re-run the workflow review (`Workflow code-review high 192` with the stacked-base note) and confirm the #1/#2/#3/#5/#6/#7/#8 findings no longer appear.

## Self-Review (author checklist)

1. Coverage: each finding row above maps to a task (R1 tests + R2 for #1/#2/#3/#6/#7; R3 for #5; R4 for #8/cast/docs).
2. The e2e tests go through `.View`/`useData`, not the runner alone (the gap that hid #1).
3. No `data === undefined` heuristic remains in `toLoaderState`; the cast in Step 4 of R2 is reshaped away (or reduced to one documented boundary).
4. Type names consistent: `settled`, `toLoaderState(data, error, settled, reloading)`, `LoaderDataContext: LoaderState | StreamState | null` across R2/R3/R6.
