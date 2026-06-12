# Prefetch on intent: `usePrefetch` (Section C, primitive 3) design

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Source:** Section C (primitive 3, "prefetch-on-intent in `NavLink`") of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`. Third of the six site-discovered primitives.
**Goal:** Kill the two real smells in the site's hand-rolled prefetch link: a copied route-pattern string and hand-wired intent handlers. Ship a `usePrefetch(href, refs)` hook that resolves `href` to its route params from the route manifest and returns a trigger to bind to any event; migrate `IssueRow` onto it.

## Scope decisions (locked with user)

1. **Minimal framework sliver (not the full NavLink primitive).** The only genuinely framework-shaped part is resolving an `href` to the target route's params, which needs the route table (framework-owned). The rest (event wiring, calling `prefetch`) is thin. So this ships the small piece that earns its keep, not an opinionated NavLink prefetch prop.
2. **A hook reading a context, NOT a global singleton.** `prefetch()` is a plain async function and cannot read context, so making `prefetch()` itself resolve the manifest would require a module-level manifest registry, i.e. another global singleton (declined for primitive #2 for the same reason). Instead a `usePrefetch` hook reads an internal route-manifest context provided by `Routes`. `prefetch()` is unchanged.
3. **A single trigger function, bound to any event by the consumer.** `usePrefetch` returns `() => void`, not a fixed `{ onMouseEnter, onFocus }`. Which events express "intent" is the consumer's policy (hover/focus, touch, pointerenter, IntersectionObserver, long-press), not the framework's. `() => void` is assignable to any event handler.
4. **The user names the loader ref(s).** A lazy route's loaders are not on the client until you navigate, so they cannot be auto-discovered on hover; and the site deliberately prefetches only the primary loader. So `refs` is required, not auto-resolved.
5. **NavLink integration deferred.** Once `usePrefetch` exists, a `<NavLink prefetch={refs}>` prop is a trivial later increment. Out of scope here.

## API

Exported from the iso barrel (`packages/iso/src/index.ts`):

```ts
export function usePrefetch(
  href: string,
  refs: LoaderRef<unknown> | ReadonlyArray<LoaderRef<unknown>>
): () => void;
```

`usePrefetch` returns a stable callback. When called, it resolves `href` to the target route's location (params) from the manifest and prefetches each named loader for that location. Bind the callback to whatever events you want:

```tsx
const prefetchIssue = usePrefetch(href, serverLoaders.issue);
<a href={href} onMouseEnter={prefetchIssue} onFocus={prefetchIssue} />;
```

`prefetch()` already no-ops on a warm cache (its `serializeLocationForCache` check), so binding to multiple events or a repeatedly-firing one is free; no debounce or policy is baked in.

## Internal route-manifest context

New internal `RouteManifestContext` (e.g. `packages/iso/src/internal/route-manifest.tsx`) carrying the flat route list:

```ts
export const RouteManifestContext = createContext<ReadonlyArray<FlatRoute>>([]);
```

`Routes` (`define-routes.tsx`) wraps its rendered `Router` in `RouteManifestContext.Provider value={routes.flat}` so any descendant (every page is one) can read the patterns. The context is internal (not a public export); only `usePrefetch` reads it. `FlatRoute.path` is the route pattern (e.g. `/demo/projects/:projectId/issues/:issueId`).

## `href` -> params resolution

`usePrefetch` reads `RouteManifestContext`, parses `href` to a path + searchParams (reusing the URL parsing already in `prefetch.ts`'s `buildLocation`), and finds the best-matching route among the flat patterns:

- Match each `FlatRoute.path` against the href path with preact-iso's `exec` (the same matcher `route-active.ts` uses).
- Among matches, pick the most specific (the route the router would land on): prefer literal segments over `:param` over `*`, then more segments. A small specificity comparator in the hook's module; the common case is a single match, so this is a tiebreak for catch-all overlaps.
- Build the location as `{ path, pathParams: <matched params>, searchParams }` and pass it to `prefetch(ref, { location })` for each ref.
- If no route matches (e.g. used outside `Routes`, or an off-manifest href), the trigger is a no-op (prefetch is best-effort; never throw from an intent handler).

This is exactly the "copied route pattern" the site hand-maintained, now derived from the one source of truth.

## Dogfood migration

`apps/site/src/components/demo/IssueRow.tsx` (the only consumer): remove `const ISSUE_ROUTE = '/demo/projects/:projectId/issues/:issueId';`, the `useCallback` `onPrefetch` (which called `prefetch(serverLoaders.issue, { url: href, route: ISSUE_ROUTE })`), and the `prefetch`/`useCallback` imports if now unused. Add `const prefetchIssue = usePrefetch(href, serverLoaders.issue);` and keep the existing `onMouseEnter={prefetchIssue} onFocus={prefetchIssue}` bindings on the anchor inside the `ViewTransitionName` render. Behavior is unchanged (still prefetches only the primary `issue` loader on hover/focus); the route-pattern copy and the prefetch plumbing are gone.

## Docs

A short "Prefetch on intent" section on `apps/site/src/pages/docs/link-prefetch.mdx` (the existing prefetch docs page) showing `usePrefetch(href, refs)` and that the returned callback binds to any event. No new page. Follow the `add-docs-page` conventions for the added section.

## Tests

New `packages/iso/src/__tests__/use-prefetch.test.tsx`:
- The returned trigger, when called, calls `prefetch` with the loader ref and a location whose `pathParams` were resolved from the manifest pattern (render the harness inside a `RouteManifestContext.Provider` with a `:id`-style pattern; spy on `prefetch` by mocking `../prefetch.js`, or assert the loader's cache was populated for the resolved key). Verify the params come from the manifest, not from a hand-passed pattern.
- An href that matches no manifest pattern makes the trigger a no-op (no `prefetch` call, no throw).
- Repeated calls dedupe via the existing warm-cache check (a second call with a warm cache issues no new fetch). This may be covered by `prefetch`'s own tests; assert at least that calling the trigger twice does not double-fetch when the cache is warm.

Mock `../prefetch.js`'s `prefetch` to a spy (the cleanest way to assert the resolved location), mirroring how `page.test.tsx` mocks a dependency. A `RouteManifestContext.Provider` supplies the patterns.

## Breaking changes

None. `usePrefetch` is an additive export; `prefetch()` is unchanged; `Routes` gains an internal context provider (no surface change). The site migration is behavior-preserving.

## Out of scope (deferred)

- `NavLink` `prefetch` prop (a later increment once `usePrefetch` exists).
- Prefetch policy (hover delay, Save-Data / slow-connection opt-out, touch heuristics): deliberately left to the consumer's choice of events.
- Auto-discovering a route's loaders (not feasible client-side pre-navigation).
- The remaining Section C primitives (#4 typed params, #5 single-source guards, #6 content-glob).
