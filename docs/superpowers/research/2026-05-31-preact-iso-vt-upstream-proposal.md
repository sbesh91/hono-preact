# Upstream proposal: let preact-iso's Router support view transitions for suspending routes

**Date:** 2026-05-31
**Target:** `preactjs/preact-iso` (pinned dep `preactjs/preact-iso#v3`)
**Status:** Analysis + proposal, ready to turn into an issue/PR. PoC not yet built.

## Problem (accurate framing)

A consumer that wants to animate route changes with the View Transition API
wraps the route swap in `document.startViewTransition`. The natural anchor is
`onRouteChange`. This works for routes that render **synchronously** (cached
data / already-loaded lazy component) but produces a **no-op transition**
(identical before/after snapshots, no animation) for routes that **suspend**
(lazy `import()` or async data) — which is the common cold-load case.

This is NOT specific to "the first navigation"; that's just the most visible
instance (after a full reload every route is cold). Any navigation whose
destination suspends is affected.

## Root cause (verified in-browser)

`Router`'s commit effect fires `onRouteChange` on the first **non-suspending**
commit after a navigation:

```js
useLayoutEffect(() => {
  if (didSuspend.current) { /* ...mark hydration DOM... */ return; }
  ...
  if (prevRoute.current !== path) {
    if (props.onRouteChange) props.onRouteChange(url);
    prevRoute.current = path;
  }
  if (props.onLoadEnd && isLoading.current) props.onLoadEnd(url);
  isLoading.current = false;
}, [path, wasPush, c]);
```

For a suspending route the sequence is:

1. Render: new route suspends → `this.__c` keeps `prev` (old route) and
   schedules un-suspend via `RESOLVED.then(update)`. The commit effect sees
   `didSuspend === true` and returns early (no `onRouteChange`).
2. The Suspense **fallback** commits (a render that does NOT suspend) → effect
   runs with `didSuspend === false`, `prevRoute !== path` → **`onRouteChange`
   fires here**, and `prevRoute` is set to `path`.
3. Later, the data resolves → `update()` → re-render commits the real
   **content** (`prev` → `null`). But now `prevRoute === path`, so
   `onRouteChange` does NOT fire again (only `onLoadEnd` does).

So `onRouteChange` fires at step 2 (fallback), while the real DOM swap to
content happens at step 3. A consumer VT anchored to `onRouteChange` captures
the old snapshot and then `flushSync`es nothing (the content swap is gated on
the async resolve, not pending) → identical snapshots → no animation.

### Evidence (Firefox, instrumented Router + consumer)

- **Warm/sync nav:** no `SUSPEND`; effect fires `onRouteChange` with the swap
  pending; the consumer's `flushSync` commits it inside the transition →
  animates. (Consumer probe at the VT callback showed the new route already
  present, old snapshot captured before.)
- **Cold/suspending nav:** `[iso] SUSPEND` → effect (`didSuspend=true`, skip) →
  effect (`didSuspend=false`, fires `onRouteChange`) on the fallback → much
  later `[iso] UNSUSPEND -> RESOLVED.then(update)`. Consumer probe: `#app`
  content identical before/after `flushSync` → no-op.
- Consumer-side attempts to wait for the deferred swap inside the
  `startViewTransition` callback fail: `requestAnimationFrame` deadlocks
  (observed 7–15s — rAF can't fire during the VT update phase), and
  microtask/`setTimeout(0)` fire before the content commits.

### Why it cannot be fixed in the consumer

The only moment with the **old route still mounted AND the new content ready**
is step 3 (the post-suspense `update`), and that moment is internal to
preact-iso. `onRouteChange` is too early (fallback), `onLoadEnd` is too late
(content already swapped, old gone), and waiting inside a VT callback
deadlocks. So the fix must live in preact-iso.

## Proposed change

**Option B (preferred): a commit-wrapping hook.** Add a prop, e.g.
`wrapUpdate?: (commit: () => void) => void` (default `commit => commit()`),
that the Router calls around its DOM-mutating commits — importantly around the
post-suspense `update` path. A view-transition consumer passes
`wrapUpdate={commit => document.startViewTransition(commit)}`. preact-iso keeps
owning *when* the swap happens; the consumer owns *wrapping* it. This avoids
baking VT policy into preact-iso and lets richer consumers (e.g. a framework
with a multi-phase VT toolkit) keep their own API.

Sketch (post-suspense path):

```js
// in this.__c's e.then(), replacing `RESOLVED.then(update)`:
RESOLVED.then(() => {
  const commit = () => flushSync(update); // flushSync from preact/compat
  (props.wrapUpdate || (c => c()))(commit);
});
```

The synchronous path would route through the same `wrapUpdate` so warm navs are
wrapped consistently (capturing old → committing new content inside the
transition). Exact wiring needs iteration with maintainers (flushSync import,
SSR guards, skipping the initial hydration commit, the `count`/staleness
guard).

**Option A (alternative): native opt-in VT.** A boolean/`onTransition` prop
where the Router itself calls `document.startViewTransition` around swaps. Less
flexible (policy lives in the router); listed for completeness.

## Validation plan for the PR

1. Patch `wrapUpdate` into `Router` (both sync and post-suspense commit paths).
2. Pass `wrapUpdate={c => document.startViewTransition(c)}` from a demo with a
   lazy/suspending route; confirm a cold navigation animates (old content →
   new content), and that warm navs still animate, with no double transition.
3. Confirm no regression when `wrapUpdate` is omitted (default path unchanged).

## Consumer follow-up (hono-preact side)

If accepted, hono-preact should delegate the swap-wrapping to preact-iso's
`wrapUpdate` instead of the current `startViewTransition(() => flushSync())`
hack anchored on `onRouteChange` (`packages/iso/src/internal/route-change.ts`),
so the 4-phase VT toolkit fires around the real content swap for both sync and
async routes. This is the proper fix for
`docs/superpowers/research/2026-05-30-first-nav-view-transition-noop.md`.
