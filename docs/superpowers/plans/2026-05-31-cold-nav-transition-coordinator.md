# Defer-aware view-transition coordinator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one coherent view transition fire per navigation, with lifecycle phases + types anchored to the transition that wraps the real DOM swap — for warm, cold-flat, and cold-nested navs.

**Architecture:** A small state machine in `route-change.ts`. The top Router's `onRouteChange` fires `beforeTransition`; if a route is loading it stashes the `ViewTransitionEvent` as `pending` and starts nothing, otherwise it runs the transition immediately (warm). Routers' `wrapUpdate` calls the shared commit handler, which — if a `pending` exists — runs the single transition wrapping that commit with the deferred phases. `onLoadStart`/`onLoadEnd` from every Router maintain a `loadingDepth` counter that decides warm vs cold.

**Tech Stack:** Preact, preact-iso (fork with the `wrapUpdate` prop), `flushSync` from `preact/compat`, Vitest (happy-dom), web-test-runner (preact-iso side, untouched here).

**Branch:** `vt-cold-nav-coordinator` (already created off `demo-view-transitions`). Spec: `docs/superpowers/specs/2026-05-31-cold-nav-transition-coordinator-design.md`.

---

## Task 1: Phase 0 — confirm the event-sequence assumptions (browser)

This validates the two load-bearing assumptions before coding. Strong prior evidence already exists from earlier instrumentation this session (a cold nav logged `SUSPEND` before `onRouteChange`, and the first `wrapUpdate` showed `old → content`), so the expected result below is the baseline; this task re-confirms it against the `loadingDepth` model and checks the two robustness risks.

**Files:**
- Temporary edits only (reverted in this task): `packages/iso/src/define-routes.tsx`, `packages/iso/src/internal/route-change.ts`.

- [ ] **Step 1: Add temporary instrumentation**

In `define-routes.tsx`, temporarily give every Router `onLoadStart`/`onLoadEnd`/`wrapUpdate` that log, and in `route-change.ts` log at `__dispatchRouteChange`. Concretely, add a module-level counter and log lines:

```ts
// TEMP in define-routes.tsx (module scope)
let __depth = 0;
const __onLoadStart = () => { __depth++; console.log('[p0] onLoadStart depth=', __depth); };
const __onLoadEnd = () => { __depth = Math.max(0, __depth - 1); console.log('[p0] onLoadEnd depth=', __depth); };
const __wrap = (commit: () => void) => {
  const t = (document.getElementById('app')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40);
  console.log('[p0] wrapUpdate pre depth=', __depth, t);
  commit();
  console.log('[p0] wrapUpdate post', (document.getElementById('app')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40));
};
```
Pass `{ onLoadStart: __onLoadStart, onLoadEnd: __onLoadEnd, wrapUpdate: __wrap }` to both Router call sites (the top Router in `Routes` and the nested one in the layout wrapper). In `__dispatchRouteChange`, add `console.log('[p0] onRouteChange', to, 'from', from);` after the `beforeTransition` loop.

- [ ] **Step 2: Run the three nav types and record the logs**

Run `pnpm --filter site dev`, open Chrome devtools console, and for each: a **warm** nav (navigate to a route, back, then forward to it again), a **cold-flat** nav (hard refresh on `/demo`, click "Go to projects →"), and a **cold-nested** nav (hard refresh on `/demo/projects`, click an unvisited project). Record the order of `[p0]` lines and the `depth` at each `onRouteChange`.

Expected (the design assumes):
- warm: `onRouteChange` with `depth === 0`, then a synchronous swap (no `wrapUpdate`).
- cold: one-or-more `onLoadStart` (`depth > 0`) BEFORE `onRouteChange`, `onRouteChange` sees `depth > 0`, then `wrapUpdate pre` shows the OLD content and `wrapUpdate post` shows the NEW content; `depth` returns to 0 by the end.
- cold-nested: the FIRST `wrapUpdate` is the page-level (outer) commit.

- [ ] **Step 3: Decide and record**

Confirm assumptions (a) `depth > 0` at cold `onRouteChange`, (b) first `wrapUpdate` is page-level, (c) `depth` returns to 0 (no leak, incl. navigating away mid-load), (d) whether a warm nav can arrive while `depth > 0`. Append a short "Phase 0 findings" note to the spec file. **If (a) or (b) is false, STOP and re-plan.** If (c) leaks or (d) is reachable, note it — the coordinator below already degrades gracefully (a mis-stashed `pending` is discarded on the next dispatch; a warm nav mis-classified as cold simply doesn't animate), so proceed unless the leak is gross.

- [ ] **Step 4: Revert the instrumentation**

```bash
git checkout -- packages/iso/src/define-routes.tsx packages/iso/src/internal/route-change.ts
```

- [ ] **Step 5: Commit the findings note**

```bash
git add docs/superpowers/specs/2026-05-31-cold-nav-transition-coordinator-design.md
git commit -m "docs(spec): record Phase 0 instrumentation findings"
```

---

## Task 2: Build the coordinator in route-change.ts

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts`
- Test: `packages/iso/src/__tests__/route-change-coordinator.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/route-change-coordinator.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __wrapRouteCommit,
  __noteLoadStart,
  __noteLoadEnd,
  __subscribePhase,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

function installFakeVt() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));
  const startViewTransition = vi.fn((cb: () => void) => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: { add: (t: string) => typeAdds.push(t) },
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition, typeAdds, resolveFinished };
}

describe('defer-aware transition coordinator', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('warm nav (depth 0): transition runs at dispatch', () => {
    const { startViewTransition } = installFakeVt();
    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('cold nav: dispatch starts nothing; first commit runs the single transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __noteLoadStart(); // depth -> 1 (route loading)
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).not.toHaveBeenCalled();
    __wrapRouteCommit(() => swapped.push('content'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(swapped).toEqual(['content']);
  });

  it('cold nav: post-swap phases fire against the deferred transition with the nav types', () => {
    const { typeAdds } = installFakeVt();
    const phases: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () => phases.push('beforeTransition'));
    const u2 = __subscribePhase('beforeSwap', () => phases.push('beforeSwap'));
    const u3 = __subscribePhase('afterSwap', () => phases.push('afterSwap'));
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    expect(phases).toEqual(['beforeTransition']); // only beforeTransition at dispatch
    __wrapRouteCommit(() => {});
    expect(phases).toEqual(['beforeTransition', 'beforeSwap', 'afterSwap']);
    expect(typeAdds).toContain('nav-same-origin'); // types applied to the real transition
    u1(); u2(); u3();
  });

  it('nested cold nav: one transition, the second commit runs directly', () => {
    const { startViewTransition } = installFakeVt();
    const order: string[] = [];
    __noteLoadStart(); __noteLoadStart(); // two routers loading
    __dispatchRouteChange('/b', '/a');
    __wrapRouteCommit(() => order.push('outer'));
    __wrapRouteCommit(() => order.push('inner'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['outer', 'inner']);
  });

  it('initial load (no dispatch): commit runs directly with no transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __wrapRouteCommit(() => swapped.push('home'));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(swapped).toEqual(['home']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/route-change-coordinator.test.ts`
Expected: FAIL — `__wrapRouteCommit`, `__noteLoadStart`, `__noteLoadEnd`, `__resetTransitionStateForTesting` are not exported.

- [ ] **Step 3: Rewrite `route-change.ts` as the coordinator**

Replace the body of `packages/iso/src/internal/route-change.ts` from the `__lastNavTypes` declaration through the end of `__dispatchRouteChange` with the following. Keep the imports, `PhaseName`/`PhaseSub`/`LegacySub` types, `phaseSubs`, `legacySubs`, `__subscribePhase`, `__subscribeRouteChange`, `fireLegacy`, `getStartViewTransition`, and the `ensureDefaultTypes`/`resetDefaultTypesForTesting` block at the bottom unchanged.

Remove entirely: `__lastNavTypes`, `__getLastNavTypes`.

Add this in their place (above `__dispatchRouteChange`):

```ts
// Coordinator state. `loadingDepth` is how many Routers are mid-suspense (via
// their onLoadStart/onLoadEnd). `pending` is a cold navigation whose
// beforeTransition has fired but whose transition is deferred until the route's
// content commits (see __wrapRouteCommit).
let loadingDepth = 0;
let pending: ViewTransitionEvent | null = null;

export function __noteLoadStart(): void {
  loadingDepth++;
}
export function __noteLoadEnd(): void {
  loadingDepth = Math.max(0, loadingDepth - 1);
}

/** @internal Test-only reset for coordinator state. */
export function __resetTransitionStateForTesting(): void {
  loadingDepth = 0;
  pending = null;
}

function fireAfterSwap(event: ViewTransitionEvent): void {
  for (const sub of phaseSubs.afterSwap) sub(event);
  // Legacy subscribers fire at the afterSwap slot: after the DOM swap, before
  // the browser begins animating the new frame.
  fireLegacy(event.to, event.from);
}

function fireAfterTransition(
  event: ViewTransitionEvent,
  reason?: 'skipped' | 'unsupported' | 'aborted'
): void {
  if (reason !== undefined) event.reason = reason;
  for (const sub of phaseSubs.afterTransition) sub(event);
}

// Runs `swap` wrapped in a view transition (when available), firing the
// post-swap phases and applying the event's accumulated types. Used by both the
// warm path (swap = no-op; flushSync flushes the already-pending route render)
// and the cold path (swap = the deferred content commit).
function runTransition(event: ViewTransitionEvent, swap: () => void): void {
  if (event._skipped) {
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'skipped');
    return;
  }
  const start = getStartViewTransition();
  if (!start) {
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'unsupported');
    return;
  }
  let transition: ViewTransition;
  try {
    transition = start(() => {
      flushSync(swap);
    });
  } catch {
    // Non-conformant / polyfilled startViewTransition that throws synchronously:
    // still perform the swap so the navigation completes.
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'unsupported');
    return;
  }
  event.transition = transition;
  for (const sub of phaseSubs.beforeSwap) sub(event);
  fireAfterSwap(event);
  const vtTypes = (
    transition as ViewTransition & { types?: { add(t: string): void } }
  ).types;
  if (vtTypes && typeof vtTypes.add === 'function') {
    for (const t of event.types) vtTypes.add(t);
  }
  transition.finished.then(
    () => fireAfterTransition(event),
    () => fireAfterTransition(event, 'aborted')
  );
}

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  ensureDefaultTypes();
  const direction: NavDirection = getNavDirection();
  const event = new ViewTransitionEvent({ to, from, direction });

  for (const sub of phaseSubs.beforeTransition) sub(event);

  if (loadingDepth > 0) {
    // Cold navigation: the route is still loading, so its real content swap
    // happens later via __wrapRouteCommit. Defer the transition to that commit.
    // (A still-unconsumed pending from a prior nav is discarded here.)
    pending = event;
    return;
  }

  // Warm navigation: the route render is already pending; flushSync inside the
  // transition commits it.
  runTransition(event, () => {});
}

// Called from each Router's `wrapUpdate` (preact-iso fork). Runs the deferred
// transition for the current cold navigation, or commits directly when there is
// none (a later nested commit, the initial route load, or a post-load
// re-suspense).
export function __wrapRouteCommit(commit: () => void): void {
  if (pending) {
    const event = pending;
    pending = null;
    runTransition(event, commit);
  } else {
    commit();
  }
}
```

- [ ] **Step 4: Run the new test**

Run: `pnpm exec vitest run packages/iso/src/__tests__/route-change-coordinator.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing route-change tests (no regression)**

Run: `pnpm exec vitest run packages/iso/src/__tests__/route-change.test.ts packages/iso/src/__tests__/route-change-phases.test.ts`
Expected: PASS. (Default `loadingDepth === 0` means those dispatches take the warm path, identical to before.)

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/__tests__/route-change-coordinator.test.ts
git commit -m "feat(iso): defer-aware view-transition coordinator"
```

---

## Task 3: Wire define-routes.tsx to the coordinator

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`

- [ ] **Step 1: Replace the imports + `wrapRouteUpdate` block**

Replace the top block (the `flushSync` import line through the `ViewTransitionLike` type and the whole `wrapRouteUpdate` function — currently lines 8-51) with:

```ts
import { lazy, Route, Router, useLocation } from 'preact-iso';
import type { RouteHook } from 'preact-iso';
import { RouteLocationsProvider } from './internal/route-locations.js';
import {
  __noteLoadEnd,
  __noteLoadStart,
  __wrapRouteCommit,
} from './internal/route-change.js';
```

(Removes the `preact/compat` `flushSync` import, the `__getLastNavTypes` import, the `ViewTransitionLike` type, and the `wrapRouteUpdate` function — all now in `route-change.ts`.)

- [ ] **Step 2: Wire the nested layout Router**

In the layout wrapper (currently around line 338), change the nested Router props to include the load hooks:

```ts
          h(
            asRouteComponent(Router),
            {
              wrapUpdate: __wrapRouteCommit,
              onLoadStart: __noteLoadStart,
              onLoadEnd: __noteLoadEnd,
            },
            ...inner
          )
```

- [ ] **Step 3: Wire the top Router in `Routes`**

In the `Routes` component (currently around line 507), change the top Router props:

```ts
  return h(
    asRouteComponent(Router),
    {
      wrapUpdate: __wrapRouteCommit,
      onLoadStart: __noteLoadStart,
      onLoadEnd: __noteLoadEnd,
      ...(onRouteChange ? { onRouteChange } : {}),
    },
    ...routes.flat.map((r) =>
      h(Route, {
        key: r.key,
        path: r.path,
        component: asRouteComponent(r.component),
      })
    )
  );
```

- [ ] **Step 4: Build the framework (typecheck)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: all packages build (`Done`), no type errors.

- [ ] **Step 5: Run the view-transitions integration test**

Run: `pnpm exec vitest run packages/iso/src/__tests__/view-transitions-integration.test.tsx`
Expected: PASS (3 tests). The lazy routes suspend, so the click-driven nav now defers and the transition fires once at the deferred commit; the initial mount has no dispatch so no transition fires (matching the existing assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-routes.tsx
git commit -m "feat(iso): drive Router transitions through the coordinator (load hooks + wrapUpdate)"
```

---

## Task 4: Fix the inaccurate client-entry comment (review nit #5)

**Files:**
- Modify: `packages/vite/src/client-entry.ts`

- [ ] **Step 1: Tighten the comment**

Replace the `lastPath` seed comment (the block above `let lastPath = ...`) with:

```ts
    // Seed lastPath with the initial pathname so the FIRST client navigation
    // reports a defined `from` to user callbacks (useViewTransitionTypes /
    // useViewTransitionLifecycle). preact-iso doesn't fire onRouteChange on the
    // initial hydration mount, so without this the first nav's `from` would be
    // undefined. (Built-in direction is computed from the history shim, not
    // `from`, so only `from`-reading user callbacks are affected.)
```

- [ ] **Step 2: Verify the client-entry test still passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/client-entry.test.ts`
Expected: PASS (the seed assertion is unchanged; only the comment changed).

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/client-entry.ts
git commit -m "docs(vite): clarify client-entry lastPath seed comment"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full local CI sequence**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter site build
```
Expected: all pass. (If the unit run flakes on `exports.test.ts` timeouts under load, re-run it in isolation: `pnpm exec vitest run packages/hono-preact/__tests__/exports.test.ts`.)

- [ ] **Step 2: Browser verification (Chrome)**

Run `pnpm --filter site dev`. Log in, then verify:
- **Warm** nav still slides (drill into a project, back to projects, drill in again → forward slide).
- **Cold-flat**: hard refresh on `/demo`, click "Go to projects →" → the projects page slides in (forward).
- **Cold-nested**: hard refresh on `/demo/projects`, click an unvisited project → the project page slides in (forward); "← all projects" slides reverse.
- **Lifecycle correctness**: temporarily add `useViewTransitionLifecycle({ onAfterTransition: (e) => console.log('reason', e.reason) })` somewhere in the demo, do a cold nav, confirm `reason` is `undefined` (not `'aborted'`). Remove the temp log.
- Console shows **no `AbortError`** during navigations.

- [ ] **Step 3: Confirm no leftovers**

Run: `grep -rn "wrapRouteUpdate\|__getLastNavTypes\|__lastNavTypes\|\[p0\]" packages apps 2>/dev/null | grep -v node_modules`
Expected: no matches.

---

## Self-review notes

- **Spec coverage:** Phase 0 → Task 1. Coordinator architecture (state machine, warm/cold branch, `__wrapRouteCommit`, removal of `__lastNavTypes`) → Task 2. `define-routes` wiring (wrapUpdate + load hooks on top & nested Routers, removal of `wrapRouteUpdate`) → Task 3. Error handling (`try/catch`, dropped `AbortError` swallow, pending-discard) → folded into Task 2's `runTransition`/`__dispatchRouteChange`. Review nit #5 → Task 4. Testing (unit warm/cold/nested/initial, integration, browser) → Tasks 2 & 5.
- **Naming consistency:** `__noteLoadStart`/`__noteLoadEnd`/`__wrapRouteCommit`/`__resetTransitionStateForTesting`/`runTransition`/`fireAfterSwap`/`fireAfterTransition`/`loadingDepth`/`pending` used identically across Tasks 2 and 3.
- **No placeholders:** every code step shows full before/after.
