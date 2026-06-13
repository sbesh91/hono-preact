# PR #96 guard-layer cleanups

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan
**Source:** the two follow-ups recorded after the single-source-page-guards deep review (`project_pr96_guards_followups` memory). Both are pure-internal cleanups whose justification eroded as a side effect of PR #96; both ride a single PR (two commits).

## Background

PR #96 made `use` on the route node the single source of a page guard. The render-side guard is now applied by the route builder (`withLeafGuard` for leaves, inside `makeLayoutGroupComponent` for layout groups), each wrapping a node's component in a `PageMiddlewareHost`. Two pieces of pre-#96 wiring are now vestigial.

## Cleanup 1: remove `Page.use` and the empty host

### Current state
`definePage` renders `<Page Wrapper errorFallback location>` and, since #96, never passes `use`. `Page` (`packages/iso/src/page.tsx`) still always renders:

```
<RouteBoundary errorFallback={...}>
  <PageMiddlewareHost use={use} location={location}>   // use is always undefined -> defaults to []
    <Wrapper id data-loader="null">{children}</Wrapper>
  </PageMiddlewareHost>
</RouteBoundary>
```

So every framework page mounts a no-op `PageMiddlewareHost` (empty chain), and `Page.use` is fed only by a hypothetical user-written `<Page use={...}>`. `Page.use` is referenced by zero site code, zero docs, and only the host-plumbing test; by the standing dogfood-or-delete rule it is a removal candidate.

### Change
Remove `use?: PageUse` from `PageProps`. `Page` becomes:

```
<RouteBoundary errorFallback={errorFallback}>
  <Wrapper id data-loader="null">{children}</Wrapper>
</RouteBoundary>
```

`Page` no longer imports or renders `PageMiddlewareHost`; the route builder (`withLeafGuard` / `makeLayoutGroupComponent` in `define-routes.tsx`) becomes the sole creator of `PageMiddlewareHost`. `Wrapper`, `errorFallback`, the `useId` id, and `data-loader="null"` are unchanged.

This is a breaking change to the public `Page` component (it loses its `use` prop). Accepted: `Page.use` is unused/undemoed, and the route node is now the one way to declare page-layer middleware.

### Why loader/lazy suspension stays correct
`RouteBoundary` already wraps children in its own `<Suspense fallback={fallback}>` one level above the host (`route-boundary.tsx:59`), and `Page` passes no `fallback`, so both that boundary and the host's inner `<Suspense fallback={fallback}>` resolve with the same `undefined` fallback. On the initial-load path the host uses `DeferredHost`, which does not add a Suspense at all, so `RouteBoundary`'s Suspense is already the boundary that catches loader suspension during hydration. Removing the page's host therefore leaves loader and lazy-component suspension caught by `RouteBoundary`'s Suspense with identical behavior (SSR prerender awaits it, client shows the same empty fallback). The empty host is genuinely redundant.

What the empty host did that is NOT lost: it ran no middleware (empty chain), consumed `HonoRequestContext` only to run server middleware (none), and provided the hydration double-mount fix only when a client guard redirects (none for an empty chain). Guarded pages keep all of this via the route builder's own host.

### Out of scope
`PageMiddlewareHost`'s unused `fallback` prop is left as-is (the route builder still constructs the host; a separate micro-cleanup). `definePage`'s `Wrapper`/`errorFallback` are unchanged.

## Cleanup 2: inline the resolver core into `makePageActionResolvers`

### Current state
`makeRouteModuleResolvers<TMod, TComposed, TExtra>` (`packages/server/src/route-module-resolvers.ts`, 106 lines) is a generic "shared core" with strategy callbacks (`createExtra`, `compose`) that owns the build lifecycle (load each thunk once, lazy build, cache the built result, dev rebuild, evict-on-failure) plus `byPath` (URL -> best pattern via `findBestPattern`). PR #96 retired its other consumer (the page-use resolver), so `makePageActionResolvers` (`page-action-resolvers.ts`) is now the sole caller, and it exercises all three type params. The generic-plus-callback indirection no longer earns its keep for one concrete consumer (the mirror of the UI "extract on the second copy" rule).

### Change
Inline the build lifecycle + `byPath` directly into `makePageActionResolvers`, specialized to its concrete types (`ServerModule`, `Map<string, ActionEntry>`, and the `byModuleKey` index map). Delete `route-module-resolvers.ts`. `makePageActionResolvers` becomes self-contained: load modules once with a thunk cache, compose the per-path action map and the by-module-key index, cache with dev-rebuild and evict-on-failure, and expose `byPath` (via `findBestPattern`, imported directly) and `byModuleKey`. Behavior is identical.

`route-pattern.ts` stays (still used by `makePageUseResolver` and now directly by `makePageActionResolvers`). `internal-runtime.ts` does not export `makeRouteModuleResolvers`, so nothing else is affected.

### Tests
`route-module-resolvers.test.ts` tested the build lifecycle generically. Its load-bearing behaviors (load-each-thunk-once, cached build, dev rebuild bypasses the cache, evict-on-failure does not poison the cache, `byPath` most-specific matching) must retain coverage. Fold those assertions into the `makePageActionResolvers` tests (driving them through real `ServerModule` shapes with `serverActions`), then delete `route-module-resolvers.test.ts`. The existing action-resolution tests (by path, by module key, ancestor composition, page-action shadowing) are the parity oracle for the inlined behavior.

## Testing strategy (whole PR)

- Cleanup 1: the existing loader-rendering + render tests (loader content still appears after suspension, SSR and client) and `page-guards-render.test.tsx` (guards still gate via the route builder) are the safety net; update `page.test.tsx` (drop any assertion that passed `use` to `Page` or depended on `Page` rendering a host; keep Wrapper/errorFallback/render assertions). `Page.use` removal itself is verified by the iso build (`page.tsx` compiles without the prop) and `pnpm typecheck` (nothing passes `use` to `Page`).
- Cleanup 2: the action-resolver tests plus the ported lifecycle assertions; a clean cross-package build and full unit suite confirm no consumer broke.
- Full six-step pre-push CI before the PR.

## Non-goals

No behavior change for guarded pages, loaders, actions, or the public guard model. No change to `defineApp`/`definePage` bindings beyond removing `Page.use`. No new abstractions; this PR only deletes vestigial ones.
