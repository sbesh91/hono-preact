# Framework bug: first same-document navigation runs a no-op view transition

**Date:** 2026-05-30
**Status:** Root-caused with in-browser evidence. NOT fixed (fix needs in-browser iteration).
**Severity:** P2. The first client navigation after a full page load shows no view-transition animation, in any direction. Every later navigation animates correctly.

## Symptom

After a hard refresh, the very first same-document navigation plays no view
transition (no slide, no fade), regardless of direction. The page content
still updates; it just snaps instead of animating. The second and subsequent
navigations animate normally.

Surfaced while building the demo's directional slides: with only a root fade
the no-op first transition was easy to miss, but the slides made it obvious.

## Evidence (Chrome, demo app)

Probe placed on the persistent `/demo` layout logging `#app` text content at
the `beforeTransition` and `afterSwap` view-transition phases, distinguishing
the old route (project layout's "all projects" link) from the new route
("Your projects" heading), navigating project/issue → `/demo/projects`:

- **First nav after refresh:** `beforeTransition` and `afterSwap` BOTH show the
  old route still present (`allProjectsLink = true`, `YourProjects = false`).
  The new route never appears during the transition window; the swap lands
  after the transition finishes. => the transition captures old → old (no-op).
- **Later nav:** `beforeTransition`/`afterSwap` show neither marker, i.e. the
  destination's "Loading projects…" fallback is in `#app` during the
  transition. The swap (old → fallback) happens inside the window, so there's a
  real before/after diff and the animation plays.

`useViewTransitionLifecycle` also confirmed the first nav's transition runs to
completion (`afterTransition reason = undefined`) with the correct types
applied (`nav-up, nav-initial, nav-same-origin`). So this is purely a DOM-swap
timing problem, not types/CSS/skip.

## Root cause

The dispatcher wraps the swap as
`document.startViewTransition(() => flushSync(() => {}))`
(`packages/iso/src/internal/route-change.ts`). `flushSync(() => {})` only
commits an *already-pending* synchronous Preact update. On warm/later
navigations the route swap (to the destination or its Suspense fallback) is
pending when preact-iso fires `onRouteChange`, so `flushSync` commits it inside
the transition callback and the snapshots differ. On the **first** navigation
(fresh from hydration) preact-iso schedules the route swap *later* than the
`onRouteChange` layout effect, so at `flushSync` time nothing is pending, the
callback is a no-op, and the actual swap is applied after the transition ends.

In short: the framework assumes the route swap is a pending synchronous update
at dispatch time. That holds on later navs but not on the first nav, because
preact-iso's first-navigation (post-hydration) scheduling defers the commit.

## Attempted fix and why the obvious approach fails (2026-05-31)

Tried making the `startViewTransition` update callback async and pumping the
deferred swap into the transition window. In-browser results (Firefox via MCP,
instrumenting `route-change.ts` to log `#app` content before/after each flush
inside the callback):

- Baseline first nav: `pre-flush` and `post-flush` are identical (old route);
  `flushSync` is a complete no-op, the swap is not pending.
- `await Promise.resolve()` / `await setTimeout(0)` then `flushSync`: still the
  old route after ~1ms. The swap is NOT microtask- or macrotask-scheduled.
- `await requestAnimationFrame` then `flushSync`: the swap DOES land (new route
  present), but the rAF took **7–15 seconds** to fire. `requestAnimationFrame`
  is blocked during the view-transition update phase (the browser won't render
  the next frame until the callback resolves, and rAF won't fire until it
  renders), so it only fired when some unrelated render was forced.

Conclusion: the deferred first-nav swap requires a real **render frame**, and
the `startViewTransition` callback cannot wait for one without deadlocking. So
the swap must be *synchronously pending* for the framework's
`startViewTransition(() => flushSync())` pattern to work. On the first
post-hydration nav it isn't, and no in-callback wait can fix that.

## Fix direction (not yet implemented)

Given the above, an in-callback wait is a dead end. Remaining options:

- **preact-iso level:** stop deferring the first post-hydration route swap to a
  render frame (make it a synchronous pending update like later navs). preact-iso
  is a pinned GitHub-tarball dep, so this is an upstream change.
- **Priming on load:** consume preact-iso's first-nav deferral during hydration
  with a throwaway commit cycle so the user's first real nav is already "warm."
  Unverified and risky (potential hydration flash / double-render); not shipped.

Earlier, superseded idea (kept for context):

Make the route swap actually happen *inside* the transition callback on the
first nav. Options to evaluate in a real browser:

- Use an async `startViewTransition` update callback that awaits the
  destination route being ready (its data/render) before performing the swap,
  instead of a synchronous empty `flushSync`. `document.startViewTransition`
  supports a promise-returning update callback and waits for it before
  capturing the new snapshot.
- Or defer the transition start until preact-iso signals the new route is about
  to commit (investigate `onLoadStart`/`onLoadEnd` vs `onRouteChange` ordering
  on the first nav), capturing the old snapshot first.

Either path needs careful in-browser iteration against preact-iso v3 (a pinned
GitHub-tarball dep) on the P0 routing path; it can't be verified headlessly.

## Demo impact

None blocking: the demo's view transitions (directional slides, shared-element
morphs, the `nav-up` reverse slide) all work on every navigation after the
first. Only the literal first navigation after a full reload snaps.
