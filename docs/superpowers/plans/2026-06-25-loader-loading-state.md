# Loader Loading-State Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the framework's loader loading model from suspense-based to state-based (`loading` in `.View()`, user owns the loading render), which lets us delete every `preact/compat` import from the runtime, so compat's global `options` renderer patches never load.

**Architecture:** The loader runner stops throwing and exposes `{ data, loading, error, reload, status }` as state; `.View()` surfaces `loading` and a possibly-`undefined` `data`. Loaders no longer suspend, so SSR and hydration render the same branch (no adoption machinery). The two remaining suspension points use preact-iso's public `ErrorBoundary` instead of vendored Suspense: `route-boundary` drops Suspense entirely, `page-middleware-host` keeps suspending on preact-iso's `ErrorBoundary`. The two `useSyncExternalStore` call sites move to a compat-free `useStoreSnapshot`. Fresh branch off post-v0.8 `main`; supersedes/closes PR #172.

**Tech Stack:** Preact 10.29.1 (core only), preact-iso (`github:preactjs/preact-iso#v3`, provides `ErrorBoundary` + its own `options.__e` patch), preact-render-to-string 6.6.7 (compat-agnostic async render), @preact/preset-vite 2.10.5, vitest 4, @testing-library/preact.

## Global Constraints

- **No `preact/compat` / `@preact/compat` import anywhere in shipped source** when done (`packages/*/src`, `apps/site/src`), excluding comments and the `leak-test` fixture. This is the whole point; it is all-or-nothing.
- **Loaders must never throw/suspend.** Loading is state surfaced through `.View()`. The page middleware chain is the only framework code that still suspends, and only onto preact-iso's `ErrorBoundary`.
- **Hydration parity:** SSR and the initial client render must produce the same branch (data present, or `status==='connecting'` for live). No SSR-DOM-adoption code.
- preact-iso's `ErrorBoundary` signature is `{ children, onError? }`; pass NO `onError` so genuine errors/outcomes propagate to the framework's outer `ErrorBoundary` (which rethrows outcomes). It catches only thrown promises (via preact-iso's installed `options.__e` patch) and re-renders on resolve, no fallback.
- No em-dashes in prose, comments, or commit messages. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- All work in the worktree `.claude/worktrees/loader-loading-state/` on branch `worktree-loader-loading-state` (off post-v0.8 `main`). Never commit to the primary checkout or the parked `remove-preact-compat` worktree. No `git push` / PR unless asked.
- Definition of done: the 8-step pre-push CI gate plus the spec's change-specific checks (Task 8).
- This is a breaking change; every `.View()` call site in `apps/site` + framework tests migrates within this plan. Record the breaking surface in the next release-notes draft.

---

### Task 1: Compat-free `useStoreSnapshot`; move the two action hooks off compat

**Files:**
- Create: `packages/iso/src/internal/use-store-snapshot.ts`
- Modify: `packages/iso/src/use-action-result.ts` (line 2 import; lines 40-42 subscription)
- Modify: `packages/iso/src/use-form-status.ts` (line 1 import; lines 17-19 subscription)
- Test: `packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx` (new); existing `use-action-result.test.tsx` / `use-form-status.test.tsx` must still pass.

**Interfaces:**
- Produces: `export function useStoreSnapshot<T>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => T): T`

- [ ] **Step 1: Write the hook**

Create `packages/iso/src/internal/use-store-snapshot.ts`:
```ts
import { useEffect, useReducer } from 'preact/hooks';

/**
 * Minimal compat-free `useSyncExternalStore(subscribe, getSnapshot)`. Hand-rolled
 * so the framework never imports preact/compat (which installs global options
 * patches). useReducer force-update driven by `subscribe`; snapshot read on render.
 * Deviation: does not re-read the snapshot at subscribe time. These are synchronous
 * in-memory stores written only by post-mount events, so the tear window is empty.
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const [, forceUpdate] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => forceUpdate()), [subscribe]);
  return getSnapshot();
}
```

- [ ] **Step 2: Write a failing guard test**

Create `packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useStoreSnapshot } from '../use-store-snapshot.js';

describe('useStoreSnapshot', () => {
  it('reads snapshot and re-renders on store change', async () => {
    let value = 'a';
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    const set = (v: string) => {
      value = v;
      listeners.forEach((l) => l());
    };
    const View = () => <span>{useStoreSnapshot(subscribe, () => value)}</span>;
    const { getByText } = render(<View />);
    expect(getByText('a')).toBeTruthy();
    set('b');
    await waitFor(() => expect(getByText('b')).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run it; expect PASS**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx`
Expected: 1 passed.

- [ ] **Step 4: Swap the action hooks**

In `use-action-result.ts`: delete the `import { useSyncExternalStore } from 'preact/compat';` (line 2) and add `import { useStoreSnapshot } from './internal/use-store-snapshot.js';`. Replace the `useSyncExternalStore(...)` call (lines 40-42) with `useStoreSnapshot(subscribeLastActionResult, () => isBrowser() ? getLastActionResult(stub) : null)`. (`subscribeLastActionResult` is a stable module-level fn, so `[subscribe]` never churns.)

In `use-form-status.ts`: same swap, `import { useStoreSnapshot } from './internal/use-store-snapshot.js';`, replace lines 17-19 with `useStoreSnapshot(subscribe, () => isBrowser() ? isPending(stub) : false)`. Delete the now-stale "preact/compat 10.29 ships only the 2-arg" comment (lines 14-16).

- [ ] **Step 5: Run the action-hook suites**

Run: `pnpm vitest run packages/iso/src/__tests__/use-action-result.test.tsx packages/iso/src/__tests__/use-form-status.test.tsx packages/iso/src/__tests__/form.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/use-store-snapshot.ts packages/iso/src/internal/__tests__/use-store-snapshot.test.tsx packages/iso/src/use-action-result.ts packages/iso/src/use-form-status.ts
git commit -m "refactor(iso): compat-free useStoreSnapshot for the action hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Disable preset-vite react aliasing; drop the compat dedupe + site aliases

**Files:**
- Modify: `packages/vite/src/hono-preact.ts` (line 113 `...preact()`; line 71 dedupe)
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts` (dedupe assertion)
- Modify: `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts` (dedupe array)
- Modify: `apps/site/package.json` (delete 3 `@preact/compat` aliases)
- Modify: `apps/site/src/pages/docs/vite-config.mdx` (dedupe table row)

**Interfaces:** none consumed/produced by later tasks (independent).

- [ ] **Step 1: preset-vite + dedupe**

In `packages/vite/src/hono-preact.ts`: change line 113 `...preact(),` to `...preact({ reactAliasesEnabled: false }),` (verify the option name against `@preact/preset-vite@2.10.5`'s `index.d.mts`; default is `true`). Change line 71 dedupe from `['preact', 'preact/compat', 'preact/hooks', 'preact-iso']` to `['preact', 'preact/hooks', 'preact-iso']`.

- [ ] **Step 2: Negative assertion in the plugin test**

In `packages/vite/src/__tests__/hono-preact.test.ts`, beside the existing `expect(result.resolve.dedupe).toContain('preact')` assertions, add:
```ts
expect(result.resolve.dedupe).not.toContain('preact/compat');
```

- [ ] **Step 3: leak-test fixture + site aliases + docs**

In `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`, remove `'preact/compat'` from its `dedupe` array. In `apps/site/package.json`, delete the three lines `"react": "npm:@preact/compat"`, `"react-dom": "npm:@preact/compat"`, `"react-is": "npm:@preact/compat"`. In `apps/site/src/pages/docs/vite-config.mdx`, change the dedupe table row to list `preact`, `preact/hooks`, `preact-iso` (drop `preact/compat`).

- [ ] **Step 4: Reinstall (site aliases changed) + run vite tests**

Run:
```bash
pnpm install
pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts
```
Expected: install completes; plugin tests pass. (Real react may now resolve for hoofd's peer in the lockfile, that is fine and never bundled, per the spec's predecessor analysis.)

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/__tests__/hono-preact.test.ts packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts apps/site/package.json apps/site/src/pages/docs/vite-config.mdx pnpm-lock.yaml
git commit -m "build: stop preset-vite react->compat aliasing; drop preact/compat dedupe + site aliases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Loader runner returns loading state (bridge: keep `reader` for now)

**Files:**
- Modify: `packages/iso/src/internal/use-loader-runner.tsx` (return type lines 19-26; return stmt lines 336-343)
- Test: `packages/iso/src/__tests__/loader-runner-c.test.tsx` (extend) or a new `use-loader-runner.test.tsx`

**Interfaces:**
- Produces: the runner's return type becomes
  ```ts
  export type LoaderRunnerState<T> = {
    data: T | undefined;       // resolved value; undefined on cold load, PREVIOUS value retained during reload
    loading: boolean;          // true while a fetch/stream-connect is in flight (cold load or reload)
    error: Error | null;
    reload: () => void;
    status: StreamStatus;
    reader: { read: () => T };  // BRIDGE: kept this task only; removed in Task 4
  };
  ```
  `data` is derived without throwing: it is `overrideData` when defined, else the synchronously-available value for SSR-preload/cache-hit paths, else `undefined`. `loading` is true whenever a load is in flight (reuse `inFlightRef`/`reloading` and the cold-load-unresolved condition).

- [ ] **Step 1: Write failing tests for the new state fields**

Add to `packages/iso/src/__tests__/loader-runner-c.test.tsx` (or new file) a `@vitest-environment happy-dom` suite that renders a component using `useLoaderRunner` against a controllable fetch and asserts the state machine (use the test file's existing harness/mocks for `fetchLoaderData`):
```tsx
// cold load: data undefined + loading true, then resolves
it('cold load exposes loading then data without throwing', async () => {
  // mount with a pending fetch; assert runner.loading === true && runner.data === undefined
  // resolve the fetch; assert runner.loading === false && runner.data === <value>
});
// reload: keeps previous data while loading
it('reload retains previous data while loading', async () => {
  // after first resolve (data = A, loading false), call reload() with a pending fetch
  // assert runner.loading === true && runner.data === A (stale-while-revalidate)
  // resolve; assert data === B, loading false
});
// SSR-preload / cache hit: data present, loading false, never pending
it('preloaded data is available immediately with loading false', () => { /* ... */ });
```
Model these on the existing `loader-runner-c.test.tsx` harness (it already drives the runner). Assert the RETURNED state, not a thrown reader.

- [ ] **Step 2: Run; expect FAIL** (`data`/`loading` not yet on the return)

Run: `pnpm vitest run packages/iso/src/__tests__/loader-runner-c.test.tsx`
Expected: FAIL (the new fields are undefined / state transitions wrong).

- [ ] **Step 3: Reshape the runner**

In `use-loader-runner.tsx`: add `data` and `loading` to `LoaderRunnerState<T>` and the return statement. Derive `data = overrideData !== undefined ? overrideData : <sync-available-value-or-undefined>`; never call a throwing `reader.read()` to compute it. Compute `loading` from the in-flight condition: true while `inFlightRef.current` is set or a cold load has not resolved (`data === undefined && status === 'connecting'/'pending'` and no error). Keep `reader` in the return for this task (bridge). Ensure the resolution paths (lines 248-259 streaming, 320-331 single-value) already drive `overrideData`/`status`/`loadError` via the existing `setX` calls so the state is complete without a throw.

- [ ] **Step 4: Run; expect PASS**

Run: `pnpm vitest run packages/iso/src/__tests__/loader-runner-c.test.tsx`
Expected: PASS. Also run `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx` to confirm the bridge keeps the still-Suspense loader path green.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/__tests__/loader-runner-c.test.tsx
git commit -m "feat(iso): loader runner exposes data/loading state (bridge keeps reader)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewire `loader.tsx` + `view-renderer` to state; remove Suspense/DataReader/DelayedFallback/live-anchor; drop the bridge

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx` (line 4 Suspense import; lines 81-112 Suspense/DataReader/fallback JSX; DataReader fn lines 138-151)
- Modify: `packages/iso/src/internal/view-renderer.tsx` (`ViewRenderArgs` lines 16-22; render call line 45 to add `loading`)
- Modify: `packages/iso/src/internal/contexts.ts` (or wherever `LoaderDataContext` lives): carry `loading`
- Modify: `packages/iso/src/internal/use-loader-runner.tsx` (remove the bridge `reader` field)
- Test: rewrite `packages/iso/src/internal/__tests__/loader.test.tsx`, `loader-streaming.test.tsx`, `view-renderer.test.tsx`, `packages/iso/src/__tests__/loader-view.test.tsx`

**Interfaces:**
- Consumes: `LoaderRunnerState<T>` `{ data, loading, error, reload, status }` from Task 3.
- Produces: `ViewRenderArgs` gains `loading: boolean`; `LoaderDataContext` value becomes `{ data, loading }`. `LoaderHost` renders the `.View()` render fn directly (no Suspense). The `.View()` render fn receives `{ data, loading, error, reload, status?, ...props }`.

- [ ] **Step 1: Rewrite loader/view-renderer tests for the state model (failing)**

Rewrite `loader.test.tsx` + `view-renderer.test.tsx` to assert: on a pending loader the render fn is called with `loading === true` and `data === undefined` (no fallback element, no Suspense boundary); after resolve, `loading === false` with data; the SSR/hydration render produces the same markup for the resolved branch. Remove assertions about a `fallback` element mounting and about `DelayedFallback`. For live loaders (`loader-streaming.test.tsx`), assert the `status==='connecting'` branch renders on SSR and flips to `'open'` with accumulated data on first chunk.

- [ ] **Step 2: Run; expect FAIL**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/internal/__tests__/view-renderer.test.tsx`
Expected: FAIL (loader still renders Suspense/fallback).

- [ ] **Step 3: Carry `loading` through context + view-renderer**

Change `LoaderDataContext` to hold `{ data: unknown; loading: boolean }`. In `view-renderer.tsx`, read `loading` from `LoaderDataContext` and include it in the `render({ data, loading, status, error, reload, ...props })` call; add `loading: boolean` to `ViewRenderArgs`.

- [ ] **Step 4: Rewrite `LoaderHost` to render state directly**

In `loader.tsx`: delete the `import { Suspense } from 'preact/compat'` (line 4), the `DataReader` component (lines 138-151), the `DelayedFallback` import+usage (lines 23-26, 95-102), and the `useId`-anchored `<section>` fallback (lines 81-87). Replace the `suspenseContent` JSX (lines 104-112) with a direct provider of `{ data, loading }` into `LoaderDataContext` wrapping `<Envelope>{children}</Envelope>` (no Suspense, no DataReader). Keep the provider stack (`ReloadContext` now `{ reload }`, `LoaderErrorContext`, `LoaderStatusContext`) and the optional `ErrorBoundary` wrap for `errorFallback`. Pull `{ data, loading, error, reload, status }` from `useLoaderRunner` (no `reader`/`overrideData`). Then remove the bridge `reader` field from `use-loader-runner.tsx`'s return + type.

- [ ] **Step 5: Run; expect PASS**

Run: `pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/internal/__tests__/view-renderer.test.tsx packages/iso/src/internal/__tests__/loader-streaming.test.tsx packages/iso/src/__tests__/loader-view.test.tsx`
Expected: all pass. Confirm `loader.tsx` no longer imports `preact/compat`: `grep -n "preact/compat" packages/iso/src/internal/loader.tsx` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/view-renderer.tsx packages/iso/src/internal/contexts.ts packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/internal/__tests__/view-renderer.test.tsx packages/iso/src/internal/__tests__/loader-streaming.test.tsx packages/iso/src/__tests__/loader-view.test.tsx
git commit -m "feat(iso): state-based loader rendering; remove Suspense/DataReader/DelayedFallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Flip the public `.View()` types and migrate every consumer

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (`SingleValueView` lines 73-83; `AccumulatingView` lines 52-69; `DefineLoaderOptions.fallbackDelay` lines 214/236-242; `LoaderRef.fallbackDelay` lines 121-127)
- Modify: the 6 `apps/site/src` `.View()` call sites (task.tsx:226/274/281, project-board.tsx:29, projects-shell.tsx:110, live-tally.tsx:11) and their `fallback` opts
- Modify: framework test `.View()` call sites flagged by typecheck
- Test: `packages/iso/src/__tests__/define-loader.test.ts` + the `*.test-d.ts` type tests

**Interfaces:**
- Consumes: the `{ data, loading, error, reload, status? }` render args from Task 4.
- Produces: `SingleValueView` render arg `{ data: Serialize<T> | undefined; loading: boolean; error: Error | null; reload: () => void }` and `opts?: { errorFallback? }` (no `fallback`). `AccumulatingView` render arg keeps `status` (no `loading`); `opts: { initial; reduce; errorFallback? }` (no `fallback`). `fallbackDelay` removed from `DefineLoaderOptions` and `LoaderRef`.

- [ ] **Step 1: Update the type-level tests (failing)**

Update `define-loader.test-d.ts` / `define-loader-fallback-delay.test-d.ts`: assert the single-value render arg includes `loading: boolean` and `data: Serialize<T> | undefined`; assert `fallback` is NOT accepted in `.View()` opts; assert `defineLoader` does NOT accept `fallbackDelay`. (The `fallback-delay` type test files get deleted or repurposed.)

- [ ] **Step 2: Run; expect FAIL**

Run: `pnpm test:types`
Expected: FAIL (current types still have `fallback`/`fallbackDelay`, no `loading`).

- [ ] **Step 3: Edit the types**

In `define-loader.ts`: add `loading: boolean` and change `data` to `Serialize<T> | undefined` in `SingleValueView`'s render arg; remove `fallback?` from both Views' opts; remove `fallbackDelay` from `DefineLoaderOptions` (lines 214, 236-242) and `LoaderRef` (lines 121-127).

- [ ] **Step 4: Migrate the 6 apps/site call sites**

For each single-value `.View()` site, remove the `fallback` opt and branch the render on `loading` (e.g. `({ data, loading }) => loading ? <Skeleton/> : <List items={data ?? []}/>`). For `project-board.tsx` use `<BoardSkeleton/>` in the `loading` branch. For the live `live-tally.tsx`, remove its `fallback`; render the `status === 'connecting'` branch as the loading affordance. The render fns already tolerate `data === undefined` (`?? []` / `if (!task)`), so keep those guards.

- [ ] **Step 5: Migrate framework test call sites + run types**

Run `pnpm typecheck` and fix every `.View()` call site it flags in framework tests (drop `fallback`, branch on `loading`). Then:
```bash
pnpm test:types
pnpm typecheck
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader.test.ts packages/iso/src/__tests__/define-loader.test-d.ts apps/site/src/pages/demo packages/iso/src/__tests__
git commit -m "feat(iso)!: .View() exposes loading + data?; remove fallback/fallbackDelay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: route-boundary drops Suspense; page-middleware-host uses preact-iso ErrorBoundary

**Files:**
- Modify: `packages/iso/src/internal/route-boundary.tsx` (line 3 import; lines 57-60 RouteBoundary)
- Modify: `packages/iso/src/internal/page-middleware-host.tsx` (line 8 import; `SuspenseHost` lines 242-276)
- Test: `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`, `packages/server/src/__tests__/render.test.tsx`, `render-stream.test.tsx`

**Interfaces:**
- Consumes: preact-iso's `ErrorBoundary` (`import { ErrorBoundary as PreactIsoErrorBoundary } from 'preact-iso'`).
- Produces: zero `preact/compat` imports remain in the framework.

- [ ] **Step 1: route-boundary**

Delete `import { Suspense } from 'preact/compat'` (line 3). Change `RouteBoundary` (lines 57-60) to render `<ErrorBoundary fallback={errorFallback}>{children}</ErrorBoundary>` (drop the inner `<Suspense fallback={fallback}>`; remove the now-unused `fallback` prop from `RouteBoundary`'s props). The exported class `ErrorBoundary` (lines 15-51) is unchanged.

- [ ] **Step 2: page-middleware-host**

Delete `import { Suspense } from 'preact/compat'` (line 8); add `import { ErrorBoundary as PreactIsoErrorBoundary } from 'preact-iso';`. In `SuspenseHost` (lines 271-275), replace `<Suspense fallback={fallback}><HostConsumer .../></Suspense>` with `<PreactIsoErrorBoundary><HostConsumer .../></PreactIsoErrorBoundary>` (no `onError`, no fallback, so the promise-suspension is caught + resumed by preact-iso while real errors/outcomes propagate to the outer framework `ErrorBoundary`). `DeferredHost` is unchanged. The `fallback` arg threaded into `SuspenseHost` becomes unused, remove it.

- [ ] **Step 3: Rewrite middleware-host + render tests**

In `page-middleware-host.test.tsx`: drop assertions about a Suspense `fallback` rendering during the chain; assert the chain still suspends + resolves to the outcome (post-nav) and that `DeferredHost` renders SSR children on initial load. In `render.test.tsx` / `render-stream.test.tsx`: confirm SSR prerender still awaits the chain (`renderToStringAsync`) and produces the outcome HTML.

- [ ] **Step 4: Run; expect PASS + compat-free framework source**

Run:
```bash
pnpm vitest run packages/iso/src/internal/__tests__/page-middleware-host.test.tsx packages/server/src/__tests__/render.test.tsx packages/server/src/__tests__/render-stream.test.tsx
grep -rn "from 'preact/compat'" packages/*/src ; echo "exit=$? (1=none, good)"
```
Expected: tests pass; no `preact/compat` imports in framework source.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/route-boundary.tsx packages/iso/src/internal/page-middleware-host.tsx packages/iso/src/internal/__tests__/page-middleware-host.test.tsx packages/server/src/__tests__/render.test.tsx packages/server/src/__tests__/render-stream.test.tsx
git commit -m "feat(iso): drop compat Suspense; route-boundary error-only, middleware-host on preact-iso ErrorBoundary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Delete dead fallback machinery

**Files:**
- Delete: `packages/iso/src/internal/delayed-fallback.tsx` + `packages/iso/src/internal/__tests__/delayed-fallback.test.tsx`
- Delete: `packages/iso/src/internal/__tests__/loader-fallback-delay.test.tsx`, `packages/iso/src/__tests__/define-loader-fallback-delay.test.ts` / `.test-d.ts`
- Modify: any remaining `DEFAULT_FALLBACK_DELAY_MS` / `fallbackDelay` references flagged by grep

**Interfaces:** none.

- [ ] **Step 1: Confirm dead, then delete**

Run `grep -rn "DelayedFallback\|DEFAULT_FALLBACK_DELAY_MS\|fallbackDelay" packages/*/src` and confirm the only remaining references are the files to delete. Delete `delayed-fallback.tsx` and the four fallback-delay test files. Remove any stray import. Note: `wrap-promise.ts` is STILL used by `page-middleware-host.tsx`, do NOT delete it.

- [ ] **Step 2: Run the iso suite**

Run: `pnpm vitest run packages/iso`
Expected: all pass; no broken imports.

- [ ] **Step 3: Commit**

```bash
git add -A packages/iso
git commit -m "chore(iso): delete DelayedFallback + fallbackDelay (subsumed by state-based loading)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Docs prose, release note, full CI gate, supersede #172

**Files:**
- Modify: loader/loading docs prose (`apps/site/src/pages/docs/loaders.mdx`, `loading-states.mdx`, `streaming.mdx`, `live-loaders.mdx`, `reloading.mdx`, and any `.View(`/`fallback`/`fallbackDelay` mentions)
- Modify: the current release-notes draft under `docs/superpowers/specs/` (next release)

**Interfaces:** none.

- [ ] **Step 1: Docs prose**

Update the loader docs to the state-based model: `.View(({ data, loading }) => ...)`, `data` may be `undefined`, branch on `loading`; remove `fallback`/`fallbackDelay` documentation; live loaders use `status`. Mirror the migrated demo code.

- [ ] **Step 2: Release note**

Append to the next-release notes draft the breaking changes: `.View()` render-arg shape (`data: T | undefined`, new `loading`; `fallback` removed), `fallbackDelay`/delayed-fallback removed, and the diff-invisible compat-removal trio (`reactAliasesEnabled:false`, compat `options` patches gone, `preact/compat` off `resolve.dedupe`).

- [ ] **Step 3: Full pre-push CI gate (in order)**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # if it fails: pnpm format, commit, re-run
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: every step exits 0.

- [ ] **Step 4: Bundle compat-free assertion**

```bash
grep -rlE "forwardRef|PureComponent|CAMEL_PROPS|hoistNonReact" apps/site/dist/client; echo "client-compat-sigs exit=$?"
grep -rl "@preact/compat" apps/site/dist/client; echo "client-@preact/compat exit=$?"
grep -rn "from 'preact/compat'" packages/*/src apps/site/src | grep -v fixtures/leak-test; echo "source-imports exit=$?"
```
Expected: no compat runtime signatures, no `@preact/compat` in the client bundle, no `preact/compat` source imports (all grep exit 1 / empty).

- [ ] **Step 5: Verify the #63 redirect-double-mount behavior holds**

Run the redirect/hydration coverage (e.g. `pnpm vitest run packages/iso/src/internal/__tests__/page-middleware-host.test.tsx` plus any client-redirect test) and confirm an initial-load client redirect does not stack routes (DeferredHost path intact).

- [ ] **Step 6: Commit + report**

```bash
git add -A
git commit -m "docs(release): record loader loading-state + preact/compat removal breaking changes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Then report each gate step's result with real output. State the branch is ready and that PR #172 should be CLOSED as superseded (do not push/PR unless asked).

---

## Self-Review

**Spec coverage:**
- Spec Design #1 (runner stops throwing, exposes state) -> Task 3.
- Spec Design #2 (`.View()` `loading`/`data?`, accumulating keeps `status`, remove fallback/fallbackDelay) -> Task 5 (types) + Task 7 (delete machinery).
- Spec Design #3 (loader.tsx no Suspense) -> Task 4.
- Spec Design #4 (route-boundary ErrorBoundary only) -> Task 6.
- Spec Design #5 (page-middleware-host on preact-iso ErrorBoundary, SSR-await + #63 intact) -> Task 6 + Task 8 Step 5.
- Spec Design #6 (no vendored suspense.tsx) -> never created (Global Constraints).
- Spec Design #7 (mechanical compat bits) -> Task 1 (useStoreSnapshot/hooks) + Task 2 (vite/aliases).
- Spec hydration-parity -> Task 4 Step 1 tests + Task 8 Step 4.
- Spec breaking-change surface -> Task 5 (API) + Task 8 Step 2 (release note).
- Spec verification -> Task 8 Steps 3-5.
- Spec supersede/close #172 -> Task 8 Step 6.

**Placeholder scan:** Task 3 Step 1 and Task 4 Step 1 give test SHAPES with `/* ... */` because they adapt the existing harnessed runner/loader suites (the harness + mocks already exist in those files); the behavioral assertions to write are stated explicitly (cold-load loading->data, reload stale-while-revalidate, SSR connecting branch). All other steps have concrete code/edits. No "TBD"/"add error handling".

**Type/name consistency:** `LoaderRunnerState<T>` fields (`data`/`loading`/`error`/`reload`/`status`, bridge `reader` added T3 removed T4) are consistent across Tasks 3-4; `ViewRenderArgs.loading` (T4) matches `SingleValueView` render arg `loading` (T5); `LoaderDataContext` value `{ data, loading }` is consistent T4. `useStoreSnapshot` signature identical in T1 definition and the consuming hooks.
