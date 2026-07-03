# Public navigation-pending API (#202) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, reactive way to observe whether a client navigation is in flight (`useNavigationState`, `subscribeNavigationState`), built on the framework's existing internal load tracker.

**Architecture:** Add a coalesced notification layer over the existing `loadingRouters` set in `packages/iso/src/internal/route-change.ts` (fired from the three sites that mutate the set), then a public hook + imperative subscribe on top of it, using the existing compat-free `useStoreSnapshot`. Purely additive observation; no runtime behavior changes.

**Tech Stack:** Preact, preact/hooks, TypeScript, Vitest (happy-dom), `@testing-library/preact`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (use commas/semicolons/parentheses).
- Casts are smells: reshape types rather than `as` (see `CLAUDE.md` "Type casts").
- Default runtime behavior is unchanged; this is purely additive observation. The scheduler keeps using `anyRouterLoading()` synchronously; the notify path is independent and must not change cold-flush timing.
- The `useStoreSnapshot` snapshot MUST be the raw `boolean` (compared by `Object.is`); returning a fresh object as the snapshot would re-render every tick. The hook wraps it into `{ pending }`.
- `pending` is `false` during SSR and initial hydration (no Router is suspended).
- New public runtime exports (`useNavigationState`, `subscribeNavigationState`, and the `NavigationState` type) must be documented in an `.mdx` under `apps/site/src/pages/docs/` (the tightened #177 `exports-coverage` gate) and any name cited in `AGENTS.md` must be real (the #177 `agents-appendix` gate).
- Pre-push, run the 8 CI-parity checks from `CLAUDE.md` in order.

---

## File structure

- `packages/iso/src/internal/route-change.ts`: add the notify layer: `navStateListeners`, `notifyScheduled`, `lastNotifiedPending`, `notifyNavState()`, `getNavPending()`, `subscribeNavState()`; call `notifyNavState()` from the three `loadingRouters` mutation sites; reset the new state in `__resetTransitionStateForTesting`. (Task 1.)
- `packages/iso/src/use-navigation-state.ts`: NEW public file: `NavigationState` type + `subscribeNavigationState` (Task 2) + `useNavigationState` hook (Task 3).
- `packages/iso/src/index.ts`: re-export the three public names.
- Tests: `packages/iso/src/__tests__/nav-state.test.ts` (Task 1 internal), `packages/iso/src/__tests__/use-navigation-state.test.tsx` (Tasks 2-3), `packages/iso/src/__tests__/use-navigation-state.test-d.ts` (Task 3 types).
- Docs: a "Global loading indicator" section in an existing navigation docs page (Task 4).

---

## Task 1: Internal notify layer over `loadingRouters`

**Files:**
- Modify: `packages/iso/src/internal/route-change.ts` (add near the `loadingRouters`/`makeRouterLoadTracker` block ~lines 68-92; call sites at the `add` ~82, `delete` ~85, and both `clear()` ~118 and ~316; reset ~117)
- Test: `packages/iso/src/__tests__/nav-state.test.ts`

**Interfaces:**
- Produces (from `packages/iso/src/internal/route-change.js`):
  - `export function getNavPending(): boolean`: true while any Router is mid-suspense.
  - `export function subscribeNavState(onChange: () => void): () => void`: stable-reference subscribe; `onChange` fires (coalesced to a microtask) only when the net pending value changes.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/nav-state.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeRouterLoadTracker,
  getNavPending,
  subscribeNavState,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';

const microtask = () => Promise.resolve();

describe('nav-pending notify layer', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => __resetTransitionStateForTesting());

  it('getNavPending reflects the loadingRouters set', () => {
    expect(getNavPending()).toBe(false);
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('notifies subscribers on the false->true and true->false transitions', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await microtask();
    expect(seen).toEqual([true]);
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([true, false]);
    off();
  });

  it('coalesces synchronous churn: two starts in one tick emit one notification', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([true]);
  });

  it('emits nothing when a burst nets to no pending change (start+end same tick)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([]);
  });

  it('a guarded Router (double onLoadStart, single onLoadEnd) ends pending=false', () => {
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadStart(); // same token; Set collapses
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('nested Routers: both must end before pending is false', () => {
    const outer = makeRouterLoadTracker();
    const inner = makeRouterLoadTracker();
    outer.onLoadStart();
    inner.onLoadStart();
    outer.onLoadEnd();
    expect(getNavPending()).toBe(true);
    inner.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('unsubscribe stops delivery; reset clears listeners', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    off();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([]);
    // and a fresh subscriber is dropped by reset
    subscribeNavState(() => seen.push(true));
    __resetTransitionStateForTesting();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: FAIL: `getNavPending` / `subscribeNavState` are not exported.

- [ ] **Step 3: Add the notify layer**

In `packages/iso/src/internal/route-change.ts`, immediately after the `loadingRouters` set declaration and `makeRouterLoadTracker` (i.e. after the existing `anyRouterLoading` function ~line 92), add:

```ts
// Public navigation-pending observation. `loadingRouters` above is the single
// source of truth; this layer notifies subscribers when the derived "any Router
// loading" boolean flips. Kept independent of the synchronous scheduler reads of
// anyRouterLoading() so it cannot affect cold-flush timing.
const navStateListeners = new Set<() => void>();
let notifyScheduled = false;
let lastNotifiedPending = false;

/** @internal true while any Router is mid-suspense (a navigation is pending). */
export function getNavPending(): boolean {
  return loadingRouters.size > 0;
}

// Coalesce synchronous churn (the scheduler's clear() then the new nav's
// onLoadStart, or a guarded route's double onLoadStart) into one microtask, and
// fire only when the net pending value actually changed.
function notifyNavState(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    const now = getNavPending();
    if (now === lastNotifiedPending) return;
    lastNotifiedPending = now;
    for (const l of navStateListeners) l();
  });
}

/** @internal Subscribe to nav-pending transitions. Stable reference. */
export function subscribeNavState(onChange: () => void): () => void {
  navStateListeners.add(onChange);
  return () => navStateListeners.delete(onChange);
}
```

- [ ] **Step 4: Fire the notifier from the three mutation sites**

In `makeRouterLoadTracker`, add `notifyNavState()` after each mutation:

```ts
export function makeRouterLoadTracker(): {
  onLoadStart: () => void;
  onLoadEnd: () => void;
} {
  const token = {};
  return {
    onLoadStart: () => {
      loadingRouters.add(token);
      notifyNavState();
    },
    onLoadEnd: () => {
      loadingRouters.delete(token);
      notifyNavState();
    },
  };
}
```

In `scheduleRender`, after the existing `loadingRouters.clear();` (the per-nav reset, ~line 316), add `notifyNavState();` on the next line.

- [ ] **Step 5: Reset the new state in the test helper**

In `__resetTransitionStateForTesting`, the existing `loadingRouters.clear();` stays; add after it:

```ts
  navStateListeners.clear();
  notifyScheduled = false;
  lastNotifiedPending = false;
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/nav-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Confirm no scheduler regression**

Run: `pnpm vitest run packages/iso/src/__tests__/route-change-coordinator.test.ts`
Expected: PASS (unchanged; the notify layer is additive).

- [ ] **Step 8: Mutation-check**

Temporarily comment out the `notifyNavState()` call in `onLoadStart`. Run the nav-state test; expected: the "notifies on transitions" and "coalesces" tests FAIL. Restore; re-run; PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/internal/route-change.ts packages/iso/src/__tests__/nav-state.test.ts
git commit -m "feat(#202): notify layer over the internal loadingRouters set"
```

---

## Task 2: `NavigationState` + `subscribeNavigationState` (imperative)

**Files:**
- Create: `packages/iso/src/use-navigation-state.ts`
- Modify: `packages/iso/src/index.ts`
- Test: `packages/iso/src/__tests__/use-navigation-state.test.tsx`

**Interfaces:**
- Consumes: `getNavPending`, `subscribeNavState` from `./internal/route-change.js` (Task 1).
- Produces:
  - `export interface NavigationState { pending: boolean }`
  - `export function subscribeNavigationState(listener: (state: NavigationState) => void): () => void`: calls `listener` once immediately with the current state, then on each change; returns unsubscribe.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/use-navigation-state.test.tsx`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeRouterLoadTracker,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { subscribeNavigationState } from '../use-navigation-state.js';

const microtask = () => Promise.resolve();

describe('subscribeNavigationState', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => __resetTransitionStateForTesting());

  it('fires once immediately with the current state', () => {
    const seen: boolean[] = [];
    const off = subscribeNavigationState((s) => seen.push(s.pending));
    expect(seen).toEqual([false]);
    off();
  });

  it('fires on each transition until unsubscribed', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavigationState((s) => seen.push(s.pending));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await microtask();
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([false, true, false]);
    off();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([false, true, false]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigation-state.test.tsx`
Expected: FAIL: module `../use-navigation-state.js` does not exist.

- [ ] **Step 3: Create the file with the type + imperative subscribe**

Create `packages/iso/src/use-navigation-state.ts`:

```ts
import {
  getNavPending,
  subscribeNavState,
} from './internal/route-change.js';

export interface NavigationState {
  /** True while a client navigation is in flight (a Router is mid-suspense). */
  pending: boolean;
}

/**
 * Subscribe to navigation-pending changes without React. Calls `listener` once
 * immediately with the current state, then on every change. Returns an
 * unsubscribe function.
 */
export function subscribeNavigationState(
  listener: (state: NavigationState) => void
): () => void {
  listener({ pending: getNavPending() });
  return subscribeNavState(() => listener({ pending: getNavPending() }));
}
```

- [ ] **Step 4: Re-export publicly**

In `packages/iso/src/index.ts`, near the other hook exports (e.g. after the `useReload` line), add:

```ts
export {
  subscribeNavigationState,
  type NavigationState,
} from './use-navigation-state.js';
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigation-state.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/use-navigation-state.ts packages/iso/src/index.ts packages/iso/src/__tests__/use-navigation-state.test.tsx
git commit -m "feat(#202): subscribeNavigationState imperative API"
```

---

## Task 3: `useNavigationState` hook (with `delayMs`)

**Files:**
- Modify: `packages/iso/src/use-navigation-state.ts`
- Modify: `packages/iso/src/index.ts`
- Test: `packages/iso/src/__tests__/use-navigation-state.test.tsx` (add cases); `packages/iso/src/__tests__/use-navigation-state.test-d.ts` (create)

**Interfaces:**
- Consumes: `getNavPending`, `subscribeNavState` (Task 1); `NavigationState` (Task 2); `useStoreSnapshot` from `./internal/use-store-snapshot.js`.
- Produces: `export function useNavigationState(options?: { delayMs?: number }): NavigationState`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/iso/src/__tests__/use-navigation-state.test.tsx` (add imports at top: `it`/`vi` from vitest already present; add `render`, `cleanup` from `@testing-library/preact`, `h` from `preact`, and `useNavigationState`):

```ts
import { render, cleanup, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { vi } from 'vitest';
import { useNavigationState } from '../use-navigation-state.js';

function Probe({ delayMs }: { delayMs?: number }) {
  const { pending } = useNavigationState(delayMs === undefined ? undefined : { delayMs });
  return h('span', { 'data-testid': 'p' }, pending ? 'pending' : 'idle');
}

describe('useNavigationState', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => {
    cleanup();
    __resetTransitionStateForTesting();
    vi.useRealTimers();
  });

  it('returns pending:false on initial render (the SSR / initial-load value)', () => {
    const { getByTestId } = render(h(Probe, {}));
    expect(getByTestId('p').textContent).toBe('idle');
  });

  it('re-renders pending:true while a load is in flight, then false', async () => {
    const { getByTestId } = render(h(Probe, {}));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    // The notify is a microtask and the store re-render is a state update
    // outside act(); waitFor polls until the DOM settles.
    await waitFor(() => expect(getByTestId('p').textContent).toBe('pending'));
    t.onLoadEnd();
    await waitFor(() => expect(getByTestId('p').textContent).toBe('idle'));
  });

  it('with delayMs, stays idle until the delay elapses', async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(h(Probe, { delayMs: 200 }));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await vi.advanceTimersByTimeAsync(0); // flush notify microtask + effect setup
    expect(getByTestId('p').textContent).toBe('idle'); // delay not elapsed
    await vi.advanceTimersByTimeAsync(200);
    expect(getByTestId('p').textContent).toBe('pending');
  });

  it('with delayMs, a load that ends before the delay never shows pending', async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(h(Probe, { delayMs: 200 }));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await vi.advanceTimersByTimeAsync(100);
    t.onLoadEnd();
    await vi.advanceTimersByTimeAsync(200);
    expect(getByTestId('p').textContent).toBe('idle');
  });
});
```

Note for the implementer: the notify path is a microtask and the store re-render is a state update outside `act()`. Use `waitFor` for the real-timer DOM assertions (as above). For the fake-timer tests, `advanceTimersByTimeAsync` also drains the microtask queue, so it settles the notify + effect; if an assertion still needs another drain, add an `await vi.advanceTimersByTimeAsync(0)`. Do not switch to arbitrary real-time `setTimeout` waits.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigation-state.test.tsx`
Expected: FAIL: `useNavigationState` is not exported.

- [ ] **Step 3: Implement the hook**

Add to `packages/iso/src/use-navigation-state.ts` (extend the imports with `useEffect`, `useState` from `preact/hooks` and `useStoreSnapshot`):

```ts
import { useEffect, useState } from 'preact/hooks';
import { useStoreSnapshot } from './internal/use-store-snapshot.js';
```

```ts
/**
 * Reactive navigation-pending state. `pending` is true while a client navigation
 * is in flight. On the server and initial hydration it is false (no Router is
 * suspended). Pass `delayMs` to report `pending: true` only after the navigation
 * has stayed pending that long (flash prevention for fast, cache-hit
 * navigations); it drops to false immediately when the navigation ends.
 */
export function useNavigationState(options?: {
  delayMs?: number;
}): NavigationState {
  const raw = useStoreSnapshot(subscribeNavState, getNavPending);
  const delayMs = options?.delayMs ?? 0;
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (delayMs <= 0) return; // `raw` is returned directly; `delayed` is unused
    if (!raw) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [raw, delayMs]);
  const pending = delayMs <= 0 ? raw : raw && delayed;
  return { pending };
}
```

- [ ] **Step 4: Re-export the hook**

In `packages/iso/src/index.ts`, extend the export added in Task 2 to include the hook:

```ts
export {
  useNavigationState,
  subscribeNavigationState,
  type NavigationState,
} from './use-navigation-state.js';
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `pnpm vitest run packages/iso/src/__tests__/use-navigation-state.test.tsx`
Expected: PASS (all cases from Tasks 2 and 3).

- [ ] **Step 6: Add the type-level test**

Create `packages/iso/src/__tests__/use-navigation-state.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest';
import {
  useNavigationState,
  type NavigationState,
} from '../use-navigation-state.js';

expectTypeOf<NavigationState['pending']>().toEqualTypeOf<boolean>();
expectTypeOf(useNavigationState).returns.toEqualTypeOf<NavigationState>();
expectTypeOf(useNavigationState).parameter(0).toEqualTypeOf<
  { delayMs?: number } | undefined
>();
```

- [ ] **Step 7: Run the type test, verify it passes**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 8: Mutation-check the delay**

Temporarily change the hook's last line to `const pending = raw;` (ignore the delay). Run the hook test; expected: the two `delayMs` tests FAIL (they would show pending immediately). Restore; re-run; PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/use-navigation-state.ts packages/iso/src/index.ts packages/iso/src/__tests__/use-navigation-state.test.tsx packages/iso/src/__tests__/use-navigation-state.test-d.ts
git commit -m "feat(#202): useNavigationState hook with opt-in delayMs"
```

---

## Task 4: Docs + gate sync

**Files:**
- Modify: an existing navigation docs page under `apps/site/src/pages/docs/` (the implementer picks the best fit by reading the docs index; a "middleware"/"navigation"/"loading-states" page. The section MUST contain the literal tokens `useNavigationState` and `subscribeNavigationState`.)
- Run: `pnpm gen:agents-corpus`

**Interfaces:** none (docs).

- [ ] **Step 1: Find the right docs page**

Run: `rg -l "loading|navigation|middleware|useReload" apps/site/src/pages/docs -g '*.mdx'` and read the closest fit (e.g. a loading-states or navigation page). Match its heading style and voice.

- [ ] **Step 2: Add a "Global loading indicator" section**

Add a section that covers both entry points and contains the literal export names (the tightened `exports-coverage` gate requires `useNavigationState`, `subscribeNavigationState`, and `NavigationState` to appear in the corpus). Example content to adapt to the page's voice:

```mdx
## Global loading indicator

`useNavigationState()` reports whether a client navigation is in flight, for an
app-wide indicator (a top-of-page progress bar, say). It returns a
`NavigationState` (`{ pending: boolean }`).

```tsx
import { useNavigationState } from 'hono-preact';

function TopProgressBar() {
  const { pending } = useNavigationState({ delayMs: 150 });
  return pending ? <div class="top-progress" /> : null;
}
```

`pending` is `false` on the server and initial load, and turns true while a
navigation suspends. Pass `delayMs` to suppress the indicator for fast,
cache-hit navigations: `pending` only turns true after the navigation has been
pending that long, and turns false the instant it finishes.

For non-React consumers, `subscribeNavigationState(listener)` calls the listener
once with the current state and then on every change, and returns an unsubscribe
function.
```

- [ ] **Step 3: Regenerate the bundled corpus**

Run: `pnpm gen:agents-corpus`
Expected: writes `packages/create-hono-preact/templates/agents/llms-full.txt`.

- [ ] **Step 4: Verify the #177 gates pass**

Run: `pnpm vitest run apps/site/src/pages/docs/__tests__/exports-coverage.test.ts packages/create-hono-preact/__tests__/agents-appendix.test.ts`
Expected: PASS (in particular `documents useNavigationState` and `documents subscribeNavigationState`).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs
git commit -m "docs(#202): document the global loading-indicator API"
```

---

## Final verification (before PR)

- [ ] Run the 8 CI-parity checks from `CLAUDE.md` in order: build framework packages; `pnpm gen:agents-corpus`; `pnpm format:check`; `pnpm typecheck`; `pnpm test:types`; `pnpm test` (or `test:coverage`); `pnpm test:integration`; `pnpm --filter site build`.
- [ ] Confirm the full suite is green and `format:check` is clean (run `pnpm format` if not).

---

## Self-review notes (coverage against the spec)

- Notify layer (coalesced microtask, dedup on net pending, fired from the three mutation sites, reset): Task 1.
- `getNavPending` / `subscribeNavState` internal API: Task 1.
- `NavigationState` type + `subscribeNavigationState` (fire-once-immediately + on change + unsubscribe): Task 2.
- `useNavigationState` hook on `useStoreSnapshot`, raw-boolean snapshot wrapped to `{ pending }`, opt-in `delayMs`: Task 3.
- SSR / initial-load `pending: false`: Task 3 (initial-render test) + inherent in `getNavPending` on an empty set.
- Docs + gate sync (three exports documented, corpus regenerated): Task 4.
- No per-boundary fallback prop (ruled out): no task, by design.
