# navigation-pending API: notify-layer correctness fix (#202 follow-up)

**Status:** approved design, pre-implementation
**Context:** a high-effort review of PR #220 found real bugs in the notify layer shipped by the initial #202 work. This fixes them before merge.

## The findings (from the PR #220 review)

1. **F1 (stuck-on).** `getNavPending()` reads `loadingRouters.size > 0` with no timeout. preact-iso fires `onLoadStart` without a matching `onLoadEnd` when a still-suspended `<Router>` unmounts (documented at `route-change.ts:358-359`); that leaked token pins `pending: true` until the next navigation clears it. A `useNavigationState()`-driven global indicator stays visible on an error page (a rejected loader whose Router the ErrorBoundary unmounts) until the user navigates away. The internal cold-flush loop tolerates the leak via `COLD_COMMIT_TIMEOUT_MS`; the public read has no such bound.
2. **F2 (interrupt blink).** The scheduler's `loadingRouters.clear()` + `notifyNavState()` at nav-start runs in an earlier microtask than the new route's `onLoadStart` (which runs inside the deferred render). Clicking A then B before A resolves emits `false` (from clear) then `true` (from B suspending). For `delayMs > 0` the showing indicator hides and re-waits the whole delay.
3. **F3 (double-delivery).** `subscribeNavigationState` fires the listener immediately, and if a notify microtask is already queued with `lastNotifiedPending` still false, the same `pending: true` is delivered again. A raw analytics listener double-counts.
4. **F4 (dup getter).** `getNavPending()` is byte-identical to the private `anyRouterLoading()`.
5. **F5 (style).** Em-dashes in the committed plan/spec prose violate the no-em-dash rule.

Why not fix F1 at the source: the leak is a Router that suspends on *first render* and unmounts before committing. It never commits, so a `useEffect` cleanup never registers and cannot fire `onLoadEnd` on unmount. The public signal must therefore bound itself.

## Chosen model

Keep `pending = "a Router is suspending"` (so instant cache-hit navigations never flash the indicator), but make it an **explicit, smoothed, self-healing state** instead of a live read of the leaky set. All logic lives in the notify layer plus two one-line reconcile hooks in the scheduler (no change to the cold-flush / view-transition / #199 hold-alive logic).

## Mechanism (route-change.ts)

Replace the live `getNavPending()` with an explicit module state:

```ts
let navPending = false;                 // the public value; getNavPending() returns THIS
let navPendingWatchdog: ReturnType<typeof setTimeout> | null = null;
const NAV_PENDING_MAX_MS = 10_000;      // self-heal bound for a leaked token

export function getNavPending(): boolean {
  return navPending;
}
```

A single coalesced `reconcile()` (still one microtask, replacing `notifyNavState`) reads the raw set and drives `navPending`, emitting only on change:

```ts
function reconcile(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    const target = loadingRouters.size > 0; // raw suspense truth
    if (target === navPending) return;      // emit only on real change (fixes F3)
    navPending = target;
    if (target) armNavWatchdog();
    else disarmNavWatchdog();
    for (const l of navStateListeners) {
      try {
        l();
      } catch (err) {
        console.error('hono-preact: a navigation-state listener threw', err);
      }
    }
  });
}
```

**F1 watchdog.** While `navPending` is true, a timer runs; if it fires (a leaked token that never drained), it force-resets:

```ts
function armNavWatchdog(): void {
  disarmNavWatchdog();
  navPendingWatchdog = setTimeout(() => {
    navPendingWatchdog = null;
    // A leaked token has pinned pending past any real navigation. Reclaim the
    // set (safe: any real nav's cold-flush wait ended long ago at
    // COLD_COMMIT_TIMEOUT_MS) and drop the public signal.
    loadingRouters.clear();
    if (navPending) {
      navPending = false;
      for (const l of navStateListeners) {
        try {
          l();
        } catch (err) {
          console.error('hono-preact: a navigation-state listener threw', err);
        }
      }
    }
  }, NAV_PENDING_MAX_MS);
}
function disarmNavWatchdog(): void {
  if (navPendingWatchdog !== null) {
    clearTimeout(navPendingWatchdog);
    navPendingWatchdog = null;
  }
}
```

Clearing `loadingRouters` in the watchdog also prevents the healed state from being immediately re-triggered by the still-present leaked token on the next reconcile.

**F2 deterministic hook.** `reconcile()` is called from exactly the points where the suspense truth is settled:
- `makeRouterLoadTracker` `onLoadStart` (add) and `onLoadEnd` (delete) — keep.
- **Removed:** the `notifyNavState()` after the scheduler's `loadingRouters.clear()` at nav-start (`route-change.ts:364`). This is what emitted the transient `false`.
- **Added:** a `reconcile()` immediately after each `process()` the scheduler runs for a *navigated* flush, so the new route's real suspend state is read after it renders:
  - VT path: after `process()` inside the transition callback (`route-change.ts:457`).
  - Non-VT path: in `scheduleRender`, when `!start` and `navigated`, schedule `() => { process(); reconcile(); }` instead of bare `process()`. Non-navigated flushes keep the bare `process()`.

On an interrupt A→B, `clear()` no longer emits, and the only reconcile reads the state after B renders (true if B suspends, false if B is a cache-hit), so there is no transient false.

**F3** is fixed by emit-on-change of explicit state (a redundant `true` is never re-delivered). **F4** is fixed because `getNavPending()` now returns the smoothed `navPending`, genuinely distinct from `anyRouterLoading()` (which stays the scheduler's live read).

The public API is unchanged: `useNavigationState`/`subscribeNavigationState`/`NavigationState`/`UseNavigationStateOptions` signatures and semantics are identical; only the internal signal quality improves. `__resetTransitionStateForTesting` additionally resets `navPending = false`, disarms the watchdog, and (already) clears `navStateListeners` / `notifyScheduled` / `lastNotifiedPending` (the last is now unused and removed).

## F5

Replace the em-dashes in `docs/superpowers/plans/2026-07-02-navigation-pending-api.md` and `docs/superpowers/specs/2026-07-02-navigation-pending-api-design.md` prose with commas / parentheses / colons.

## Testing

The existing `nav-state.test.ts` and `use-navigation-state.test.tsx` need updating for the timer-based watchdog (fake timers) and the new reconcile timing. Cases:

- **Baseline still holds:** getNavPending false→true on `onLoadStart`, true→false on `onLoadEnd` (through a reconcile microtask); coalescing (two starts → one emit); guarded double-start / single-end; nested Routers; unsubscribe; listener error isolation.
- **F1:** with fake timers, an `onLoadStart` with no matching `onLoadEnd` leaves `getNavPending()` true, then after `NAV_PENDING_MAX_MS` the watchdog forces it false and notifies; `loadingRouters` is cleared so a later reconcile does not re-raise it. A genuine `onLoadEnd` before the watchdog cancels it (no spurious heal). Mutation-check: remove the watchdog reset, confirm the leak test fails.
- **F2:** drive an interrupt directly against the scheduler harness (the `route-change-coordinator.test.ts` pattern: `installNavTransitionScheduler`, `navigateTo`, `flushRender`): A suspends (pending true), then a navigated flush for B with clear()+B-suspend must NOT emit an intermediate false to a `subscribeNavState` listener; the observed sequence stays `[true]` (or `[true]` then `[false]` only when B is a cache-hit). Mutation-check: restore the `clear()` notify, confirm the interrupt emits a spurious false.
- **F3:** subscribe in the window between an `onLoadStart` and its reconcile microtask; the listener receives `pending: true` exactly once, not twice.
- **F4:** `getNavPending()` returns the smoothed `navPending` (e.g. after a watchdog heal it is false while `loadingRouters` was non-empty before the heal's clear).

Every state-transition assertion is mutation-checked.

## Re-review

After implementation, re-run the high-effort workflow review on the branch to confirm F1-F4 are closed and no regression was introduced in the scheduler hooks.
