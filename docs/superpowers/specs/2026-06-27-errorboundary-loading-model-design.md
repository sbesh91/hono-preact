# ErrorBoundary-as-default loading model (keep route alive + hidden) design

**Date:** 2026-06-27
**Status:** Spike complete. Go/no-go = **GO with the self-heal modification.** Design approved; pending implementation plan.
**Branch:** `worktree-spike-196-errorboundary-loading` (throwaway prototype + this note)
**Closes (spike):** #196
**Relates to:** #172 (drop `preact/compat`; original maintainer nudge toward `ErrorBoundary`), #191 (state-based loaders; `LoaderState` union), #136 (delayed loader fallback), and [2026-06-25-loader-state-adt-design.md](./2026-06-25-loader-state-adt-design.md).

## TL;DR

The "keep the route alive, show a fallback alongside" boundary Ryan described **already exists**: it is preact-iso's `Router` (`[cur, prev]`). It already engages for plain lazy routes. The reason guarded-route navigations still tear the outgoing route to blank is that `SuspenseHost` interposes preact-iso's `ErrorBoundary` between the `Router` and the suspending content, catching the chain promise locally (no hold-alive).

**Approach A** removes that interposed boundary so the chain suspension reaches the `Router`. The prototype proves the `Router` then holds the outgoing route alive, **but** alone it fails to commit the incoming route, because chain suspension (`wrapPromise` / `HostConsumer`) has no self-healing re-render. Adding a self-update to `HostConsumer` (mirroring preact-iso `lazy`) fixes commit while preserving hold-alive. Both changes are small and centered on `page-middleware-host.tsx` (plus a small recommended `wrap-promise.ts` reshape). Server (SSR) and initial-load hydration are untouched.

This confirms the issue's direction: **`ErrorBoundary` (Router-as-boundary) becomes the default; the fallback-swap `<Suspense>` is no longer interposed.** It aligns with the #172 maintainer nudge.

## Ryan's two notes, reconciled

1. Issue note: *"return `[routeComponent, fallback]` from the boundary, keeping the route alive but maybe setting its root DOM node to `display: none`."*
2. Follow-up note: *"if you're using iso's router, it needs to act as the suspense boundary (unless you want to re-implement all the very janky guts of it). I'm not sure it'd be helpful there, but could be wrong!"*

The follow-up is the operative one and it is a course-correction on the first. The `[routeComponent, fallback]` hold-alive is exactly what the `Router` already does internally; reimplementing it independently means recreating preact-iso's fragile suspense plumbing (a global `options.__e` patch in `lazy.js`, the `Router`'s inline `this.__c` assignment, a `__k.reverse()` anti-diff hack, and a monotonic `count` guard). So the correct move is to let the `Router` be the boundary, not to build our own. Two corrections to the first note fall out of reading the shipped code:

- **No `display: none`.** The shipped `Router` does not hide the held route; it relies on render order (`cur` renders first so it can suspend and repopulate `prev`) plus VNode-ref juggling. `display:none` was speculative.
- **In the cold-nav case the incoming route has no DOM while suspended**, so there is no "two visible routes" problem during the pending window: the outgoing route shows alone until the incoming one commits. (See A11y below for the commit-overlap nuance.)

## Where we are today (post #191), precisely

For a leaf route **with** page middleware (`use.length > 0`) the render tree is:

```
Router (holds [cur, prev])            packages/iso/src/define-routes.tsx (top-level + per layout group)
  -> Guarded (withLeafGuard)          define-routes.tsx:309
    -> PageMiddlewareHost             internal/page-middleware-host.tsx:283
      -> SuspenseHost                 page-middleware-host.tsx:249
        -> PreactIsoErrorBoundary     page-middleware-host.tsx:277   <-- the problem
          -> HostConsumer             page-middleware-host.tsx:130   (throws the chain promise via wrapped.read())
            -> children = lazy(view)  (throws the module promise)
```

- The interposed `PreactIsoErrorBoundary` sets its own `this.__c`, so it is the **nearest** suspense boundary. Both the chain promise (from `HostConsumer.read()`) and the inner lazy view's module promise are caught **here**, locally. preact-iso's `ErrorBoundary` resume is just `err.then(() => this.forceUpdate())` — no hold-alive. So the `Router` never sees the suspension and never holds the outgoing route. Result: tear-to-blank.
- Routes **without** page middleware skip `PageMiddlewareHost` entirely (`define-routes.tsx:308`), so the lazy view's promise bubbles straight to the `Router`, which holds the outgoing route alive. This is why the behavior is inconsistent today: plain routes hold alive, guarded routes blank out.
- **Loader data no longer suspends on the client** (state-based `LoaderState` union, #191). The only client-side suspension left is the middleware chain (and lazy module loads). So the blast radius of this change is the page-middleware suspend path, not the data path.
- **`RouteBoundary`** (`internal/route-boundary.tsx`, the framework's own `ErrorBoundary`) is rendered **per route**, *inside* the Router: `definePage` wraps each page's `Component` in `<Page>` (which contains `RouteBoundary`), and that wrapped page is the route's lazy view (`define-page.tsx`, `page.tsx:36`). The client mounts only `LocationProvider > Routes(Router)` (`packages/vite/src/client-entry.ts`) — there is **no** `RouteBoundary` above the Router. `RouteBoundary` does **not** set `this.__c`, so it is transparent to thrown promises regardless; it catches real errors from the route's own subtree and rethrows framework outcomes (so the server's `renderPage` can translate them). Because it sits *below* `HostConsumer`, it never sees the chain promise (which originates at `HostConsumer` and bubbles up). It is unaffected by this change.
- **Server:** `renderPage` calls preact-iso `prerender`, which catches suspensions **globally** (awaits thrown promises and retries). The interposed boundary is not what makes SSR work, so removing it leaves SSR intact.
- **Initial load / hydration:** `PageMiddlewareHost` picks `DeferredHost` (not `SuspenseHost`) on the first browser render (`page-middleware-host.tsx:304`). `DeferredHost` renders the SSR children during hydration and runs the chain in an effect afterward — it **never suspends**, so it sidesteps the hydration-orphan (preactjs/preact#4442) and is **unaffected** by this change.

## Decision: Approach A + self-healing `HostConsumer`

### Change 1 — remove the interposed boundary (`SuspenseHost`)

`SuspenseHost` returns `HostConsumer` directly instead of wrapping it in `PreactIsoErrorBoundary`. The promise `HostConsumer` throws now bubbles to the nearest `Router`, which holds `[cur, prev]` alive while the chain resolves. Outcome handling is unchanged: `redirect` (client) and `render` are not thrown (`HostConsumer` routes them via an effect / renders `<Alt />`); only `deny` is thrown, as a **non-promise** object the `Router` ignores. On the **server**, a thrown chain outcome propagates to `renderPage`'s `try/catch` (`translateRootOutcome`), exactly as today. On the **client**, this propagation is identical to today's: the interposed `PreactIsoErrorBoundary` never caught outcomes either (it has no `onError`, so non-promise throws pass straight through it), so removing it changes nothing about client outcome propagation. (Verified: the deny-propagation path is unchanged in a real Router tree.)

### Change 2 — self-heal `HostConsumer` on chain resolve

Chain suspension via `wrapPromise` has **no self-update**: `wrapPromise.read()` throws the bare `suspender` promise (`internal/wrap-promise.ts`), and nothing re-renders `HostConsumer` when it resolves. Previously the interposed `PreactIsoErrorBoundary.forceUpdate()` provided that re-render. The `Router`'s resume holds `[cur, prev]` and re-renders the **Router**, but that does not reliably re-render the deep suspended `HostConsumer` — so the incoming route never commits.

The fix mirrors preact-iso's `lazy`, which self-updates: `r.current = p.then(() => update(1))`. `HostConsumer` registers a one-shot self re-render on the suspender's resolution, then re-throws so the `Router` still holds the outgoing route alive:

```tsx
const [, force] = useState(0);
const healed = useRef(false);
let outcome: Outcome | undefined;
try {
  outcome = wrapped ? wrapped.read().outcome : undefined;
} catch (e) {
  if (e && typeof (e as { then?: unknown }).then === 'function' && !healed.current) {
    healed.current = true;
    (e as Promise<unknown>).then(() => force((n) => n + 1));
  }
  throw e; // still suspend, so the Router holds the outgoing route alive
}
```

Implementation note: the production version should peek `wrapPromise`'s status rather than relying on `try/catch` of the thrown promise (cleaner), e.g. expose a `peek()` on `wrapPromise` so `HostConsumer` can subscribe without catching its own suspension. The prototype used `try/catch` to avoid touching `wrap-promise.ts`; the plan should prefer reshaping `wrapPromise`.

### Boundary return shape + visibility mechanism

There is **no new boundary component and no `display:none`**. The "boundary" is preact-iso's `Router`; its return shape is the existing `[RenderRef(cur), RenderRef(prev)]` array (`router.js`). Visibility is governed by suspension state, not CSS: while the incoming route is suspended it contributes no DOM, so only the outgoing route is visible. The only visibility mechanism we add is **`inert` on the incoming route's root once it has committed DOM but is not yet the active route** (see A11y).

## A11y / correctness of the held route

- **During the pending window (cold nav):** only the outgoing route has DOM; it remains fully interactive. No focus/SR conflict because there is nothing to conflict with yet. This is strictly better than today's blank.
- **Commit-overlap window:** when the incoming route commits, there is a brief overlap before the `Router` drops `prev` (sets `prev.current = null` and re-renders). During this window two routes can be in the DOM. **Mechanism: mark the incoming route's root `inert` until it becomes the active (shown) route**, so AT/focus/pointer cannot reach a not-yet-active subtree, and the outgoing route retains focus/scroll ownership until the swap completes. `inert` (Baseline Widely Available) is preferred over `display:none`/`hidden` because it preserves layout measurement for the incoming route while blocking interaction, and over `aria-hidden` alone because it also removes the subtree from tab order and pointer hit-testing.
- **Mounted-outgoing effects:** while held, the outgoing route's effects, subscriptions, and timers keep running (it is still mounted). This is the same property preact-iso already has for held lazy routes; the hold is brief (one chain resolution). Document it; do not attempt to freeze effects.
- **Duplicate IDs:** `useId` values from the outgoing route coexist with the incoming route's during overlap. Since the incoming route is `inert` and the overlap is one commit, this is acceptable; flag for the test matrix.

## Public loading-indicator surface

**Deferred** (per maintainer decision): the note documents the mechanism and trade-offs and leaves the exact public API open for the implementation phase.

- The mechanism already exists: `loadingDepth` in `internal/route-change.ts` (`__noteLoadStart` / `__noteLoadEnd`, wired to every `Router`'s `onLoadStart` / `onLoadEnd`). **This change makes `loadingDepth` increment for guarded navigations too** (previously the interposed boundary swallowed the suspension, so the `Router` never fired `onLoadStart` for guarded routes). This is the natural signal source for a global indicator (on at suspend, off after render).
- Options for the eventual surface, when it graduates: (a) a `useNavigationState()` hook / subscribe API reading `loadingDepth` (one app-styled global story, ties back to the #172 "missing global-indicator story"); (b) a per-route/per-layout boundary fallback prop (more granular, overlaps the per-loader `fallbackDelay` from #136); (c) both, layered. Recommendation deferred.

## Changes enumerated (acceptance criterion 3)

- **`packages/iso/src/internal/page-middleware-host.tsx`**
  - `SuspenseHost`: drop the `PreactIsoErrorBoundary` wrap; return `HostConsumer` directly. Remove the now-unused `ErrorBoundary as PreactIsoErrorBoundary` import. Update the `SuspenseHost` doc comment (it currently documents the interposed boundary).
  - `HostConsumer`: add the self-heal re-render on chain-promise resolution (prefer a `wrapPromise.peek()` reshape over `try/catch`).
- **`packages/iso/src/internal/wrap-promise.ts`** (recommended): add a `peek()`/status accessor so `HostConsumer` can self-heal without catching its own thrown promise.
- **`packages/iso/src/internal/route-change.ts`**: no code change required, but **validate** that `loadingDepth` now firing on guarded navigations does not mis-time the view-transition cold-flush coordination (`runNavTransition`'s `while (loadingDepth > 0)` loop). The hard reset at `scheduleRender` (`loadingDepth = 0`) already guards leaked depth.
- **Hydration path (`DeferredHost`)**: no change. It never suspends; the contract that initial-load chains run post-hydration is preserved.
- **`packages/iso/src/internal/__tests__/page-middleware-host.test.tsx`**: rewrite the 3 Router-less tests (below) to wrap the host in a real `Router` (or a `__c` boundary), matching real usage. This is the test cost of the new contract, not a behavior regression.
- **`<Page>` escape hatch (`internal.ts` documents hand-composing the pipeline)**: document the new contract that `PageMiddlewareHost` requires an ancestor suspense boundary (`Router`). The default `LocationProvider > Routes(Router)` mount already satisfies it (the `Router` is the boundary); hand-composed pipelines must provide a `Router` or equivalent `__c` boundary as an ancestor of `PageMiddlewareHost`.

## New contract (the one real cost)

`SuspenseHost` (hence `PageMiddlewareHost`) **now depends on an ancestor `__c` suspense boundary** (the `Router`) instead of being self-contained. In the real app this is always satisfied (the `Routes` `Router` is an ancestor of every `PageMiddlewareHost`). The only breakage is code that mounts `PageMiddlewareHost` without a `Router` ancestor: the 3 unit tests, and any future hand-composed pipeline. This is a deliberate, documented contract change, not an accident.

## Open risks to validate during implementation (go is not unconditional on these, but they must be checked)

1. **View-transition timing:** `loadingDepth` now moves on guarded navs; confirm the VT cold-flush (`route-change.ts`) and the morph/dispatcher work still sequence correctly. Add a VT-integration test for a guarded cold navigation.
2. **`inert` overlap correctness:** verify focus retention on the outgoing route and that the incoming route is non-interactive until active; verify no duplicate-ID a11y violations leak during overlap.
3. **Stale-resume / `count` guard:** confirm the self-heal does not double-commit or resurrect a superseded navigation when the user navigates again mid-chain (preact-iso's monotonic `count` guards the Router side; the `HostConsumer` self-heal is one-shot per wrapped promise, which is recreated per path).
4. **Redirect-in-effect path:** the existing client-redirect-in-effect in `HostConsumer` must still fire correctly with the self-heal re-render in place (the prototype kept it intact; add a guarded-redirect-during-nav test).
5. **Default-behavior change:** guarded navigations now keep the old route visible during the chain instead of blanking. This is the intended improvement but is observable; call it out in release notes when shipped.

## Evidence (prototype)

The spike applied the two changes above (Change 1 + the `try/catch` form of Change 2) to `page-middleware-host.tsx` and added a throwaway probe (`internal/__tests__/SPIKE-hold-alive.test.tsx`). Both were reverted before this note was committed (the spike is design-only, no production code); the results below are the record.

| Configuration | Test 1 (hold-alive engages) | Test 2 (incoming route commits) |
| --- | --- | --- |
| Baseline (interposed boundary) | n/a (Router never catches) | **pass** (local boundary resumes; outgoing torn to blank) |
| Approach A only (Change 1) | **pass** — `onLoadStart('/b')` fires, route A held in DOM, B not shown while pending | **fail** — B never commits (no self-heal) |
| Approach A + self-heal (Change 1 + 2) | **pass** | **pass** (61ms, was a 3s timeout) |

Full `@hono-preact/iso` suite under Approach A + self-heal: **756 passed, 3 failed** — the 3 failures are exactly the Router-less `page-middleware-host.test.tsx` tests described above; everything else (including the realistic `Routes`-based navigation, layout persistence, and SSR suites) is green. Test 1 proves the mechanism because preact-iso's `Router` fires `onLoadStart` **only** when its own `__c` catches a thrown promise.

## Recommendation

**GO**, implementing Approach A + the self-healing `HostConsumer` (with the `wrapPromise.peek()` reshape), rewriting the 3 Router-less tests, documenting the new ancestor-boundary contract and the `inert` overlap handling, and validating the five open risks during implementation. This adopts `ErrorBoundary`/Router-as-the-boundary as the default and removes the interposed fallback-swap, matching the #172 maintainer direction, at a small and well-bounded code + test cost.
