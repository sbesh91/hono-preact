# Public navigation-pending API (#202)

**Status:** approved design, pre-implementation
**Issue:** #202 (follow-up to #196 criterion 4, #199, #172; relates to #136)
**Scope:** one public read/subscribe surface over the existing internal load tracker. No per-boundary fallback prop (that overlaps the per-loader `fallbackDelay`/`LoaderState` and was ruled out).

## Problem

The framework tracks in-flight cold/guarded navigations internally
(`packages/iso/src/internal/route-change.ts`): a `loadingRouters` `Set<object>`
of Router tokens, populated by `makeRouterLoadTracker()` (one per mounted
`<Router>`, wired at two sites in `define-routes.tsx`) and read by the private
`anyRouterLoading()` predicate to drive the view-transition cold-flush hold. As
of #199 it fires for guarded navigations too. There is no public way to observe
it, so an app cannot render a global "navigation pending" indicator (the #172
gap). This ships that public surface.

Default behavior is unchanged; this is purely additive observation.

## What exists vs. what is missing

- **Exists:** `loadingRouters` (the set), `makeRouterLoadTracker()` (mutates it),
  `anyRouterLoading()` (pull predicate). The set is mutated in three places:
  `onLoadStart` (add), `onLoadEnd` (delete), and the scheduler's
  `loadingRouters.clear()` at navigation start (drops leaked tokens).
- **Missing:** a notification layer. Nothing is told when the set changes, so a
  component cannot re-render on it. This design adds that layer and a stable
  public read/subscribe API on top.

## Internal notification layer (`route-change.ts`)

A module-level listener set plus a coalesced notifier:

```ts
const navStateListeners = new Set<() => void>();
let notifyScheduled = false;

// Coalesce synchronous churn (e.g. the scheduler's clear() immediately followed
// by the new nav's onLoadStart, or a guarded route's double onLoadStart) into
// one notification per microtask. Listeners re-read getNavPending() themselves,
// so a net-unchanged burst collapses to a single (or zero) re-render via the
// snapshot's Object.is check.
function notifyNavState(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const l of navStateListeners) l();
  });
}

/** @internal true while any Router is mid-suspense (a navigation is pending). */
export function getNavPending(): boolean {
  return loadingRouters.size > 0;
}

/** @internal Subscribe to nav-pending changes. Stable reference. */
export function subscribeNavState(onChange: () => void): () => void {
  navStateListeners.add(onChange);
  return () => navStateListeners.delete(onChange);
}
```

`onLoadStart`, `onLoadEnd`, and the scheduler's `loadingRouters.clear()` each
call `notifyNavState()` after mutating the set. `getNavPending` reuses the same
`loadingRouters.size > 0` condition `anyRouterLoading()` already uses (the
scheduler keeps using `anyRouterLoading()` synchronously; the notify path is
independent and does not change cold-flush timing). `__resetTransitionStateForTesting`
clears `navStateListeners` and `notifyScheduled`.

## Public surface (from `hono-preact`)

```ts
export interface NavigationState {
  /** True while a client navigation is in flight (a Router is mid-suspense). */
  pending: boolean;
}

/** Reactive navigation-pending state. */
export function useNavigationState(options?: {
  /**
   * Report `pending: true` only after the navigation has stayed pending for
   * `delayMs` (flash prevention for fast, cache-hit navigations). Flips back to
   * false immediately when the navigation ends. Default 0 (report immediately).
   */
  delayMs?: number;
}): NavigationState;

/**
 * Low-level subscription for non-React / imperative consumers. Calls `listener`
 * once immediately with the current state, then on every change. Returns an
 * unsubscribe function.
 */
export function subscribeNavigationState(
  listener: (state: NavigationState) => void
): () => void;
```

### `useNavigationState` implementation

Built on the existing compat-free `useStoreSnapshot(subscribe, getSnapshot)`
(`internal/use-store-snapshot.ts`). The snapshot MUST be the raw boolean (it is
compared by `Object.is`; returning a fresh `{ pending }` object as the snapshot
would re-render every tick). The hook wraps it in `{ pending }` and layers the
delay per-consumer:

```ts
export function useNavigationState(options?: { delayMs?: number }): NavigationState {
  const raw = useStoreSnapshot(subscribeNavState, getNavPending); // boolean
  const delayMs = options?.delayMs ?? 0;
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (delayMs <= 0) return; // raw is returned directly; `delayed` is unused
    if (!raw) { setDelayed(false); return; }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [raw, delayMs]);
  const pending = delayMs <= 0 ? raw : raw && delayed;
  return { pending };
}
```

- `delayMs <= 0`: returns the raw signal directly (no timer).
- `delayMs > 0`: `pending` is true only once the nav has been pending for
  `delayMs` (`raw && delayed`); it drops to false the instant `raw` goes false
  (the effect's `!raw` branch resets `delayed`).

### `subscribeNavigationState` implementation

```ts
export function subscribeNavigationState(
  listener: (state: NavigationState) => void
): () => void {
  listener({ pending: getNavPending() }); // fire once with current state
  return subscribeNavState(() => listener({ pending: getNavPending() }));
}
```

## SSR / initial load

On the server and during initial hydration no Router is suspended
(`DeferredHost` never suspends), so `loadingRouters` is empty and `pending` is
`false`. `useStoreSnapshot` calls `getSnapshot()` synchronously on the server
(the `useEffect` subscription never runs there), returning `false`. No special
server-snapshot path is needed.

## Naming

`useNavigationState` / `subscribeNavigationState` / `NavigationState` — one
concept, consistent verb. Returned as an object (not a bare boolean) so future
fields (e.g. `from`/`to`) can be added without a breaking change. `from`/`to`
are NOT added now (YAGNI; no concrete consumer).

## Testing

Unit (`packages/iso/src/__tests__`), driving `makeRouterLoadTracker` directly:

- `getNavPending()` false initially; true after an `onLoadStart`; false after the
  matching `onLoadEnd`.
- A subscriber fires (after the coalescing microtask) on the false->true and
  true->false transitions; the double-`onLoadStart`-then-single-`onLoadEnd` case
  (one guarded Router) still ends pending=false; two distinct trackers (nested
  Routers) both must end before pending is false.
- `subscribeNavigationState` fires once immediately with the current state and
  returns a working unsubscribe.
- Coalescing: a synchronous `clear()`-then-`onLoadStart` within one tick does not
  emit an intermediate false to subscribers (net pending stays true after the
  microtask).

Hook (`@testing-library/preact`, happy-dom):
- `useNavigationState()` re-renders a component from `{ pending: false }` to
  `{ pending: true }` when a tracked load starts, and back.
- `delayMs`: with a fake timer, `pending` stays false until `delayMs` elapses,
  and a load that ends before `delayMs` never reports `pending: true`.
- SSR: `renderToString` of a component calling `useNavigationState()` reads
  `pending: false` without throwing.

Type-level (`*.test-d.ts`): `NavigationState.pending` is `boolean`;
`useNavigationState` accepts `{ delayMs?: number }` and no other options.

Every store-transition assertion is mutation-checked (break the notify call,
confirm the subscriber/hook test fails, restore).

## Docs

A "Global loading indicator" guide section under the navigation/middleware docs
showing the top-of-page progress-bar pattern with `useNavigationState({ delayMs })`
and a note on the imperative `subscribeNavigationState`. The three new public
exports (`useNavigationState`, `subscribeNavigationState`, `NavigationState`)
are picked up by the tightened #177 docs-coverage and AGENTS.md gates; update the
docs corpus (`pnpm gen:agents-corpus`).
