# Defer-aware view-transition coordinator design

**Date:** 2026-05-31
**Status:** Superseded by the `options.debounceRendering` implementation — see the FINAL note below. The design body and the first update are kept for history.
**Branch:** `vt-cold-nav-coordinator` (off `demo-view-transitions`)

> **FINAL (2026-05-31): driven by `options.debounceRendering`; no preact-iso
> fork.** The two designs below both anchored the transition to a preact-iso
> hook (the `wrapUpdate`/`wrapNavigation` fork, PR #150). Per maintainer feedback
> (Jovi De Croock) the whole thing moved to the consumer side on **stock
> `preactjs/preact-iso#v3`**: `installNavTransitionScheduler()` overrides
> `options.debounceRendering` (the seam `flushSync` uses) and wraps a render
> flush in `startViewTransition` when it is a navigation (the URL changed since
> the last flush — covers clicks, `route()`, popstate), so the old route is
> captured before the new one renders. Cold routes keep routing content flushes
> into the transition until `loadingDepth` hits 0 (the shell), with a short
> bounded grace for a morph partner that loads with the route's data (behind
> inner Suspense that doesn't move `loadingDepth`). No `view-transition-name`
> tricks; supersede + timeout guards remain. PR #150 was closed (unneeded). See
> commit `feat(iso): drive view transitions via options.debounceRendering`.

> **Update (2026-05-31): cold path revised for element morphs.** Browser
> verification found that deferring the whole transition to the post-suspense
> commit (the design below) cannot animate a navigation into a route that shares
> a `view-transition-name` with the originating page (a list -> detail-header
> morph): by the commit, preact-iso has already painted the destination and
> dropped the source, so the morph has no source and the two names transiently
> collide. The cold path now instead starts the transition at **dispatch** (old
> snapshot = the still-mounted source route) and bridges its async swap to the
> content commit, with `useViewTransitionName` keeping the source name through
> `prev`-keeping and deferring the destination name until the swap. A generation
> guard, resume-on-next-navigation, and a timeout keep an abandoned or stalled
> cold navigation from freezing the page. Warm and cold-flat behavior is as
> described below. See commit `feat(iso): animate element morphs across cold
> navigations`.

## Goal

One coherent view transition per navigation, with the lifecycle phases
(`beforeTransition` / `beforeSwap` / `afterSwap` / `afterTransition`) and the
navigation types firing against the transition that wraps the **real** DOM
swap, for warm, cold-flat, and cold-nested navigations alike.

## Background / problem

A route whose lazy view or loader suspends commits its content through
preact-iso's internal post-suspense update, exposed via the `wrapUpdate` Router
prop (preactjs/preact-iso#150, currently the `sbesh91/preact-iso` fork). The
existing dispatch anchors the transition to `onRouteChange`, which for a cold
route fires on the (no-op) fallback render; the real swap lands later via
`wrapUpdate`. The current implementation works around this by starting a
*second, bare* transition inside `wrapUpdate` that re-applies the types. Two
problems remain:

1. **Lifecycle phases fire against the wrong transition.** `beforeSwap` /
   `afterSwap` / `afterTransition` (and `event.reason`) run against the no-op
   `onRouteChange` transition, not the `wrapUpdate` one that actually animates.
   `useViewTransitionLifecycle` consumers see `reason: 'aborted'` and phases
   that don't correspond to the visible animation. (`useViewTransitionTypes`
   and `Persist` are unaffected.)
2. **Multiple transitions per nav.** Nested routers each call `wrapUpdate`, plus
   the `onRouteChange` no-op transition, so several `startViewTransition` calls
   supersede each other per navigation (functional, but noisy — `AbortError`s).

This was approved as a full re-architecture (Approach A) rather than a
patch, so the transition lifecycle is anchored to the real swap.

## Cold-nav UX (decided)

"Transition to shell, fill in": as soon as the new route's page-level shell is
ready, transition to it (showing any loading skeletons), then nested/data
content fills in afterward without animation. The single transition wraps the
**page-level (first) commit**; later nested/data commits just apply. This keeps
the current responsive behavior.

## Phase 0 — instrumentation (de-risk first)

Before writing the coordinator, instrument and map the exact event + DOM
sequence for three navigation types:

- **warm/sync** (revisiting a cached route),
- **cold-flat** (e.g. `/demo` → `/demo/projects`),
- **cold-nested** (e.g. `/demo/projects` → `/demo/projects/inf`).

Capture, in order, each `onLoadStart` / `onRouteChange` / `wrapUpdate` /
`onLoadEnd` with the `#app` content at that moment and the running
`loadingDepth`. This confirms the two load-bearing assumptions:

- (a) at `onRouteChange` for a cold nav, `loadingDepth > 0` (so the coordinator
  can branch on it), and
- (b) the first `wrapUpdate` is the page-level commit.

It must also validate two robustness risks:

- (c) **`loadingDepth` balance** — every `onLoadStart` is matched by an
  `onLoadEnd`, including when a route's load is *abandoned* by navigating away
  mid-load (preact-iso's `count` staleness guard drops the stale resolve; verify
  it still fires `onLoadEnd` so the counter returns to 0). If it can leak,
  switch from a global counter to a per-navigation load token (snapshot at
  `onRouteChange`).
- (d) **warm nav during a lingering load** — if `loadingDepth > 0` from an
  earlier still-loading route when a *warm* nav arrives, the warm nav would be
  misclassified as cold, stash a `pending`, and never transition (no
  `wrapUpdate` fires for it). Confirm whether this is reachable; mitigation
  below.

If any assumption is false, revisit the coordinator branch logic before
implementing. The instrumentation is throwaway logging, removed after.

## Phase 0 findings (2026-05-31)

Confirmed from this session's earlier in-browser instrumentation (Chrome via the
demo) plus the preact-iso fork source. A live re-confirmation against the
`loadingDepth` model is deferred to the Task 5 browser verification (the Firefox
MCP was unavailable when Phase 0 ran).

- **(a) `loadingDepth > 0` at a cold `onRouteChange` — CONFIRMED.** A cold nav
  logged `SUSPEND` (the Router's `this.__c`, which fires `onLoadStart`) *before*
  the `onRouteChange` effect, then `UNSUSPEND -> RESOLVED.then(update)` (the
  `wrapUpdate` trigger). So a load is in flight when `onRouteChange` runs.
- **(b) the first `wrapUpdate` is the page-level commit — CONFIRMED.** The first
  `wrapUpdate` logged `#app` going from the old route to the new route's
  page-level content (`"← all projects api Loading projects…"` →
  `"← all projects api"`); a cold-nested nav fired two `wrapUpdate`s, outer
  (page-level) first.
- **(c) `loadingDepth` balance — OK by construction.** preact-iso fires
  `onLoadEnd` in the commit effect whenever `isLoading.current` is true on a
  non-suspending commit (`router.js`), including the commit after a load is
  abandoned by navigating away, so each `onLoadStart` is matched. Re-verify in
  Task 5.
- **(d) warm nav during a lingering load — graceful.** If it occurs, the warm
  nav is mis-stashed as `pending` and simply doesn't animate (content still
  updates via the normal render); the stale `pending` is discarded on the next
  dispatch. Acceptable; no special handling.

Assumptions (a) and (b) hold, so the coordinator design below proceeds.

## Architecture

A small state machine in `packages/iso/src/internal/route-change.ts` with three
inputs and one piece of state.

State:

- `loadingDepth: number` — how many Routers are mid-suspense.
- `pending: { event: ViewTransitionEvent; types: string[] } | null` — a cold
  navigation awaiting its content commit.

Inputs:

1. **`__dispatchRouteChange(to, from)`** — called from the top Router's
   `onRouteChange` (unchanged signature, still wired by the generated client
   entry). Compute direction + types by firing `beforeTransition`. Then branch:
   - **warm** (`loadingDepth === 0`): run the transition now — exactly today's
     warm path (`startViewTransition(() => flushSync(() => {}))`, set
     `event.transition`, fire `beforeSwap` / `afterSwap`, apply types,
     `afterTransition` on `finished`). The `_skipped` and no-API fallbacks stay.
   - **cold** (`loadingDepth > 0`): store `pending = { event, types }` and
     return without starting a transition. `beforeTransition` has already fired;
     the remaining phases are deferred to the commit.
2. **`__noteLoadStart()` / `__noteLoadEnd()`** — wired to every Router's
   `onLoadStart` / `onLoadEnd`. Increment / decrement `loadingDepth` (floored at
   0).
3. **`__wrapRouteCommit(commit)`** — wired to every Router's `wrapUpdate`.
   - If `pending` is set: start the single transition that wraps the commit —
     `start(() => flushSync(() => commit()))`; set `pending.event.transition`;
     fire `beforeSwap` / `afterSwap`; apply `pending.types`; `afterTransition`
     on `finished`. Then clear `pending`. If `startViewTransition` is
     unavailable, run `commit()` and fire the post-swap phases synchronously
     (mirrors today's no-API fallback).
   - If `pending` is null (a later nested commit, the initial route load, or any
     post-load re-suspense): just `commit()` — no transition.

Net behavior: warm navs transition at `onRouteChange`; cold navs transition at
the first `wrapUpdate`, with all phases against that transition; subsequent
nested/data commits apply directly. Exactly one transition per navigation.

## Components / files

- **`route-change.ts`** — owns the coordinator. The transition-running logic
  (currently duplicated between `__dispatchRouteChange` and
  `define-routes.tsx`'s `wrapRouteUpdate`) is unified here as one internal
  helper used by both the warm and cold paths. `__lastNavTypes` /
  `__getLastNavTypes` are removed (replaced by the `pending` record). New
  internal exports: `__noteLoadStart`, `__noteLoadEnd`, `__wrapRouteCommit`.
- **`define-routes.tsx`** — drops `wrapRouteUpdate`, the `flushSync` import, and
  the `__getLastNavTypes` import. Every Router it creates (the top Router in
  `Routes` and the nested layout Router in the layout wrapper) is given
  `wrapUpdate={__wrapRouteCommit}`, `onLoadStart={__noteLoadStart}`,
  `onLoadEnd={__noteLoadEnd}`. `onRouteChange` stays top-Router-only.
- **`client-entry.ts`** — unchanged except removing the now-inaccurate comment
  about `from`-keyed direction logic (review nit #5). `onRouteChange` + the
  `lastPath` seed stay.
- **Demo / CSS** — unchanged; the `nav-initial` / `nav-up` rules already work.

## Data flow (cold-nested example)

```
onLoadStart × N         loadingDepth: 0 -> N
onRouteChange(to,from)  loadingDepth > 0  -> fire beforeTransition,
                                             stash pending, start nothing
wrapUpdate(outerCommit)  pending set      -> start ONE transition wrapping
                                             outerCommit; beforeSwap/afterSwap;
                                             apply types; clear pending
wrapUpdate(innerCommit)  pending null     -> commit directly (fills in)
onLoadEnd × N            loadingDepth -> 0
transition.finished                       -> afterTransition
```

## Error handling

- `try/catch` around `startViewTransition` so a throwing or polyfilled
  implementation still runs `commit()` and the post-swap phases (review nit #3).
- `pending` is replaced on each `onRouteChange`; a `wrapUpdate` consumes the
  latest pending (rapid-nav edge case — last navigation wins; acceptable). A
  pending from a prior navigation that was never consumed is simply discarded
  when the next `onRouteChange` overwrites it.
- **Warm-during-lingering-load mitigation** (risk (d)): if Phase 0 shows it is
  reachable, guard the cold branch so an armed `pending` is reconciled — e.g.
  if a `pending` is still set on the next `onRouteChange` (its commit never
  came), discard it and let the new nav classify itself; and/or fall back to
  running the transition at `onRouteChange` when no `wrapUpdate` consumes the
  pending within a microtask. The exact mitigation is chosen from Phase-0 data.
- The stale-types edge case (review nit #4) is gone: types live on `pending`,
  cleared after the consuming commit, so a later non-navigation re-suspense
  finds no pending and just commits with no transition.
- With one transition per navigation there is no supersede, so the previous
  `transition.finished.catch(() => {})` `AbortError` swallow is removed.

## Testing

- **Unit** (`packages/iso/src/__tests__/route-change*.test.ts`), driving load
  state via `__noteLoadStart` / `__noteLoadEnd`:
  - warm (`loadingDepth === 0`): `startViewTransition` called once at dispatch;
    callback is a function. (Keep the existing assertion.)
  - cold: dispatch starts no transition; the first `__wrapRouteCommit` starts it
    once; `beforeSwap` / `afterSwap` / `afterTransition` subscribers all fire,
    and the transition carries the navigation's types.
  - nested cold: two `__wrapRouteCommit` calls under one pending → one
    transition; the second commit runs without a transition.
  - initial load (no dispatch, `pending` null): `__wrapRouteCommit` commits
    with no transition. (Covers the "first paint must not animate" rule.)
- **Integration**: the existing `view-transitions-integration.test.tsx` stays
  green (warm path unchanged).
- **Browser** (Chrome): warm forward/back slide, cold-flat slide, cold-nested
  slide, and that `useViewTransitionLifecycle` phases fire against the real
  transition on a cold nav (e.g. `onAfterTransition` no longer reports
  `'aborted'`).

## Out of scope

- The upstream `wrapUpdate` API itself (already submitted as
  preactjs/preact-iso#150). This spec is the consumer-side coordinator.
- Changing the "transition to shell, fill in" UX (decided above).
- The release-gate on the fork dependency (tracked separately; switch back to
  `preactjs/preact-iso#v3` once the upstream PR lands).
