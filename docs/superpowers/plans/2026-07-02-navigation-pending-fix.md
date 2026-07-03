# navigation-pending notify-layer fix (#202) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the F1 (stuck-on), F2 (interrupt blink), F3 (double-delivery), F4 (dup getter), and F5 (doc em-dash) findings from the PR #220 review, making the public navigation-pending signal smoothed and self-healing.

**Architecture:** Replace the live `getNavPending() = loadingRouters.size > 0` with an explicit `navPending` state driven by a coalesced `reconcileNavState()` that emits only on change, with a self-heal watchdog (F1). Make F2 deterministic by removing the scheduler's nav-start notify and reconciling after the new route's render instead. All logic stays in the notify layer plus two one-line reconcile hooks in the scheduler.

**Tech Stack:** Preact, preact/hooks, TypeScript, Vitest (happy-dom, fake timers), `@testing-library/preact`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (commas/semicolons/parentheses instead).
- Casts are smells: reshape types rather than `as`.
- The scheduler must keep reading `anyRouterLoading()` synchronously and independently; the notify path must not change cold-flush / view-transition / #199 hold-alive timing.
- Public API is unchanged: `useNavigationState` / `subscribeNavigationState` / `NavigationState` / `UseNavigationStateOptions` signatures and semantics are identical; only the internal signal quality improves.
- `NAV_PENDING_MAX_MS = 10_000` (watchdog self-heal bound).
- Every state-transition assertion is mutation-checked.
- Pre-push, run the 8 CI-parity checks from `CLAUDE.md`.

---

## File structure

- `packages/iso/src/internal/route-change.ts` — the notify-layer rewrite (Task 1) and the two scheduler reconcile hooks (Task 2).
- `packages/iso/src/__tests__/nav-state.test.ts` — rewritten for the async/self-healing signal (Task 1); F2 interrupt test added (Task 2).
- `docs/superpowers/plans/2026-07-02-navigation-pending-api.md`, `docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md` — em-dash cleanup (Task 3).

No public-surface or hook-file changes: `use-navigation-state.ts` is untouched (it reads `getNavPending`/`subscribeNavState`, whose contracts are preserved).

---

## Task 1: Notify-layer state machine (F1, F3, F4)

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts` (notify block at lines 96-136; `getNavPending` at 104-107; the three `notifyNavState()` call sites at 83, 87, 364; reset at 161-165)
- Test: `packages/iso/src/__tests__/nav-state.test.ts` (rewrite)

**Interfaces:**
- Produces (unchanged public contract, new internals): `getNavPending(): boolean` now returns an explicit, microtask-updated `navPending`; `subscribeNavState(onChange)` unchanged. Internal `reconcileNavState()` replaces `notifyNavState()`.

- [ ] **Step 1: Rewrite the failing test file**

Replace the entire contents of `packages/iso/src/__tests__/nav-state.test.ts` with (fake timers throughout; `flush()` drains the reconcile microtask + any due timers):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeRouterLoadTracker,
  getNavPending,
  subscribeNavState,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('nav-pending notify layer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetTransitionStateForTesting();
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    vi.useRealTimers();
  });

  it('getNavPending reflects the set after the reconcile microtask', async () => {
    expect(getNavPending()).toBe(false);
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('notifies subscribers on the false->true and true->false transitions', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    expect(seen).toEqual([true]);
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([true, false]);
    off();
  });

  it('coalesces synchronous churn: two starts in one tick emit one notification', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([true]);
  });

  it('emits nothing when a burst nets to no pending change (start+end same tick)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([]);
  });

  it('a guarded Router (double onLoadStart, single onLoadEnd) ends pending=false', async () => {
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('nested Routers: both must end before pending is false', async () => {
    const outer = makeRouterLoadTracker();
    const inner = makeRouterLoadTracker();
    outer.onLoadStart();
    inner.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    outer.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(true);
    inner.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('isolates a throwing listener so other subscribers still receive the change', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    subscribeNavState(() => {
      throw new Error('boom');
    });
    subscribeNavState(() => seen.push('ok'));
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual(['ok']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('unsubscribe stops delivery; reset clears listeners', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    off();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([]);
    subscribeNavState(() => seen.push(true as unknown as boolean));
    __resetTransitionStateForTesting();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([]);
  });

  // F1: a leaked token (onLoadStart with no matching onLoadEnd) self-heals.
  it('the watchdog forces pending false after NAV_PENDING_MAX_MS when a token leaks', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart(); // leaks: never onLoadEnd
    await flush();
    expect(getNavPending()).toBe(true);
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getNavPending()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a genuine onLoadEnd before the watchdog cancels the self-heal (no double emit)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(10_000); // watchdog must have been disarmed
    expect(seen).toEqual([true, false]);
  });

  // F3: subscribing while a reconcile is queued must not double-deliver true.
  it('does not double-deliver true to a listener that subscribes before the reconcile flush', async () => {
    makeRouterLoadTracker().onLoadStart(); // queues a reconcile microtask
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    await flush();
    expect(seen).toEqual([true]); // exactly once
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: FAIL — the watchdog/F3 behavior and the async `getNavPending` semantics don't exist yet.

- [ ] **Step 3: Replace the notify layer**

In `packages/iso/src/internal/route-change.ts`, replace the whole block from the `// Public navigation-pending observation.` comment through the end of `subscribeNavState` (current lines 96-136) with:

```ts
// Public navigation-pending observation. `loadingRouters` above is the raw
// suspense truth; this layer maintains an explicit `navPending` derived from it,
// smoothed (emit only on real change) and self-healing (a watchdog). Kept
// independent of the synchronous scheduler reads of anyRouterLoading() so it
// cannot affect cold-flush timing.
const navStateListeners = new Set<() => void>();
let notifyScheduled = false;
let navPending = false;
let navPendingWatchdog: ReturnType<typeof setTimeout> | null = null;
// A leaked token (a suspended Router that unmounts without onLoadEnd, per the
// per-nav clear comment below) would pin navPending true until the next
// navigation. Cap it so a global loading indicator self-heals on, say, an error
// page whose suspending route the ErrorBoundary unmounted.
const NAV_PENDING_MAX_MS = 10_000;

/** @internal The smoothed, self-healing "a navigation is pending" signal. */
export function getNavPending(): boolean {
  return navPending;
}

function emitNavState(): void {
  for (const l of navStateListeners) {
    try {
      l();
    } catch (err) {
      // Isolate a misbehaving subscriber so the other navigation-state
      // listeners still get notified.
      console.error('hono-preact: a navigation-state listener threw', err);
    }
  }
}

function disarmNavWatchdog(): void {
  if (navPendingWatchdog !== null) {
    clearTimeout(navPendingWatchdog);
    navPendingWatchdog = null;
  }
}

function armNavWatchdog(): void {
  disarmNavWatchdog();
  navPendingWatchdog = setTimeout(() => {
    navPendingWatchdog = null;
    if (!navPending) return;
    // A leaked token has pinned pending past any real navigation. Reclaim the
    // set (safe: a real nav's cold-flush wait ended long ago at
    // COLD_COMMIT_TIMEOUT_MS) so it cannot immediately re-raise, and drop the
    // public signal.
    loadingRouters.clear();
    navPending = false;
    emitNavState();
  }, NAV_PENDING_MAX_MS);
}

// Coalesce synchronous churn (a guarded route's double onLoadStart, nested
// Routers) into one microtask, then reconcile navPending against the raw set and
// emit only when it actually changed.
function reconcileNavState(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    const target = loadingRouters.size > 0;
    if (target === navPending) return;
    navPending = target;
    if (target) armNavWatchdog();
    else disarmNavWatchdog();
    emitNavState();
  });
}

/** @internal Subscribe to nav-pending transitions. Stable reference. */
export function subscribeNavState(onChange: () => void): () => void {
  navStateListeners.add(onChange);
  return () => navStateListeners.delete(onChange);
}
```

- [ ] **Step 4: Rename the call sites**

In `makeRouterLoadTracker`, change both `notifyNavState();` calls (lines 83 and 87) to `reconcileNavState();`. In `scheduleRender`, change the `notifyNavState();` after `loadingRouters.clear();` (line 364) to `reconcileNavState();`. (Task 2 removes this last one; keep it for now so Task 1's baseline stays green.)

- [ ] **Step 5: Update the reset helper**

In `__resetTransitionStateForTesting` (lines 162-165), replace:

```ts
  loadingRouters.clear();
  navStateListeners.clear();
  notifyScheduled = false;
  lastNotifiedPending = false;
```

with:

```ts
  loadingRouters.clear();
  navStateListeners.clear();
  notifyScheduled = false;
  navPending = false;
  disarmNavWatchdog();
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Confirm the hook + scheduler suites still pass**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigation-state.test.tsx packages/iso/src/__tests__/route-change-coordinator.test.ts`
Expected: PASS. (The hook reads `getNavPending`/`subscribeNavState`, whose contracts hold; the scheduler is unchanged in this task.)

- [ ] **Step 8: Mutation-check**

Temporarily change `armNavWatchdog`'s body to a no-op (`return;` at the top). Run the nav-state test; expected: the two watchdog tests FAIL. Restore; re-run; PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/__tests__/nav-state.test.ts
git commit -m "fix(#202): explicit self-healing navPending state (F1, F3, F4)"
```

---

## Task 2: Deterministic F2 hook (interrupt blink)

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts` (remove the `reconcileNavState()` after `clear()` ~line 364; add reconcile hooks in `scheduleRender`'s non-VT navigated path ~371-375 and after `process()` in `runNavTransition` ~457)
- Test: `packages/iso/src/__tests__/nav-state.test.ts` (add an interrupt case)

**Interfaces:**
- Consumes: `reconcileNavState()`, `getNavPending`, `subscribeNavState` (Task 1), `installNavTransitionScheduler`, `makeRouterLoadTracker` (existing).

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/nav-state.test.ts` a second `describe` that drives the real scheduler (no fake VT, so the non-VT navigated path is exercised). Add the imports `installNavTransitionScheduler` from `../internal/route-change.js` and `resetHistoryShimForTesting` from `../internal/history-shim.js` at the top:

```ts
import { installNavTransitionScheduler } from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';
```

```ts
describe('nav-pending: interrupting navigation does not blink (F2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHistoryShimForTesting();
    __resetTransitionStateForTesting();
    history.replaceState(null, '', '/a');
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    resetHistoryShimForTesting();
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);
  const navigateTo = (url: string) => history.pushState(null, '', url);
  const flushRender = (fn: () => void) => options.debounceRendering!(fn);

  it('A loading then interrupt to a cold route stays pending true, no false between', async () => {
    installNavTransitionScheduler();
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const a = makeRouterLoadTracker();
    const b = makeRouterLoadTracker();

    // Nav to /b; route A suspends during its render (cold).
    navigateTo('/b');
    flushRender(() => {
      a.onLoadStart();
    });
    await flush();
    expect(seen).toEqual([true]);

    // Interrupt to /c before A resolves; the new route also suspends. The
    // scheduler's clear() drops A's token (no notify in the fixed code); the
    // new route suspends during its render, so the post-render reconcile reads
    // pending=true and no false is emitted between.
    navigateTo('/c');
    flushRender(() => {
      b.onLoadStart();
    });
    await flush();
    expect(seen).toEqual([true]);
  });

  it('A loading then interrupt to a cache-hit route goes pending true then false', async () => {
    installNavTransitionScheduler();
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const a = makeRouterLoadTracker();

    navigateTo('/b');
    flushRender(() => {
      a.onLoadStart();
    });
    await flush();
    expect(seen).toEqual([true]);

    // Interrupt to /c; the new route does NOT suspend (cache hit), so the
    // post-render reconcile reads pending=false.
    navigateTo('/c');
    flushRender(() => {
      // no suspend
    });
    await flush();
    expect(seen).toEqual([true, false]);
  });
});
```

Add `import { options } from 'preact';` at the top of the file if not already present.

Note for the implementer: this exercises the non-VT navigated path (no `document.startViewTransition` stubbed, so `getStartViewTransition()` is undefined and `scheduleRender` takes the `defaultSchedule` branch). The reconcile-after-process you add in Step 3 is what makes the cache-hit case emit `false`; removing `clear()`'s notify is what keeps the interrupt-to-cold case from emitting a spurious `false`.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: FAIL — with `clear()` still notifying, the first interrupt test sees `[true, false, true]` (a blink); the cache-hit test may not emit the final `false` yet.

- [ ] **Step 3: Remove the nav-start notify and reconcile after the render instead**

In `scheduleRender`, delete the `reconcileNavState();` line right after `loadingRouters.clear();` (the one you renamed in Task 1). The `clear()` stays; only its notify goes.

Then change the non-VT dispatch. Replace:

```ts
  const start = navigated && !skip ? getStartViewTransition() : undefined;
  if (!start) {
    defaultSchedule(process);
    return;
  }
  runNavTransition(process, start);
```

with:

```ts
  const start = navigated && !skip ? getStartViewTransition() : undefined;
  if (!start) {
    if (navigated) {
      defaultSchedule(() => {
        process();
        reconcileNavState(); // read the new route's real suspend state post-render
      });
    } else {
      defaultSchedule(process);
    }
    return;
  }
  runNavTransition(process, start);
```

In `runNavTransition`, after the first `process();` inside the transition callback (the line following the comment `// The old snapshot has been captured. Flush the navigation render.`), add `reconcileNavState();`:

```ts
      // The old snapshot has been captured. Flush the navigation render.
      process();
      reconcileNavState();
      if (navGen !== myGen) return;
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: PASS (all cases, including the two interrupt cases).

- [ ] **Step 5: Confirm no scheduler regression**

Run: `pnpm vitest run packages/iso/src/__tests__/route-change-coordinator.test.ts packages/iso/src/__tests__/guarded-nav-transition.test.tsx packages/iso/src/__tests__/view-transitions-integration.test.tsx`
Expected: PASS.

- [ ] **Step 6: Mutation-check**

Temporarily re-add `reconcileNavState();` right after `loadingRouters.clear();`. Run the nav-state test; expected: the interrupt-to-cold test FAILS (a spurious `false` reappears). Remove it again; re-run; PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/__tests__/nav-state.test.ts
git commit -m "fix(#202): reconcile nav-pending after the render, not at nav-start (F2)"
```

---

## Task 3: Doc em-dash cleanup (F5)

**Files:**
- Modify: `docs/superpowers/plans/2026-07-02-navigation-pending-api.md`, `docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md`

- [ ] **Step 1: Find the em-dashes**

Run: `grep -n "—" docs/superpowers/plans/2026-07-02-navigation-pending-api.md docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md`
Expected: several prose lines (the plan file has ~9, the spec ~1).

- [ ] **Step 2: Replace each em-dash**

For each hit, replace the ` — ` (em-dash used as a prose separator) with the punctuation that fits the sentence: a comma, a colon, parentheses, or a sentence split. Do not alter em-dashes inside fenced code blocks or inline-code spans (there should be none; the rule is about prose). Preserve meaning.

- [ ] **Step 3: Verify none remain in prose**

Run: `grep -n "—" docs/superpowers/plans/2026-07-02-navigation-pending-api.md docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md`
Expected: no prose hits (if any remain, they must be inside code fences only; there should be none).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-02-navigation-pending-api.md docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md
git commit -m "docs(#202): drop em-dashes from the navigation-pending plan and spec (F5)"
```

---

## Final verification (before re-review)

- [ ] Run the 8 CI-parity checks from `CLAUDE.md` in order: build framework packages; `pnpm gen:agents-corpus`; `pnpm format:check`; `pnpm typecheck`; `pnpm test:types`; `pnpm test` (or `test:coverage`); `pnpm test:integration`; `pnpm --filter site build`.
- [ ] Confirm the full suite is green and `format:check` is clean.

---

## Self-review notes (coverage against the fix spec)

- F1 (stuck-on) self-heal watchdog + `loadingRouters.clear()` on fire: Task 1 (watchdog tests).
- F2 (interrupt blink) deterministic post-render reconcile, `clear()` notify removed: Task 2 (interrupt tests).
- F3 (double-delivery) emit-on-change of explicit `navPending`: Task 1 (subscribe-before-flush test).
- F4 (dup getter) `getNavPending` returns smoothed `navPending`, distinct from `anyRouterLoading`: Task 1 (the getter body change; `anyRouterLoading` untouched).
- F5 (em-dashes): Task 3.
- Public API unchanged; `use-navigation-state.ts` not modified: confirmed by Task 1 Step 7 running the hook suite unchanged.
