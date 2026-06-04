# Active-route detection: `useRouteMatch`, `useRouteActive`, `<NavLink>`

- **Date:** 2026-06-03
- **Status:** Approved design, pre-implementation
- **Topic:** Add a first-class way to ask "is this route currently active?", a hook that returns the matched params (or null), a boolean convenience wrapper, and a `<NavLink>` that auto-applies active styling, so consumers stop hand-rolling `path === x` / `path.startsWith(x)`.

## Problem

There is no framework primitive for active-route detection. Every consumer that wants to highlight the current nav entry rolls its own comparison against `useLocation().path`. The docs site is the live example (`apps/site/src/components/DocsLayout.tsx`):

- Sidebar links: exact equality, `entry.route === path`.
- Top-bar area tabs: prefix match, `path.startsWith('/docs/components')`.

Both are correct but ad hoc, and neither handles dynamic routes: there is no way to say "highlight the Posts link for any `/posts/:id`." Active-link highlighting with param-aware matching is a feature most routers ship (TanStack Router's `useMatchRoute` / `<Link activeProps>`, React Router's `NavLink`). This adds the equivalent, built on machinery the framework already has.

## Goals

- A hook that tests an arbitrary route pattern against the current location and returns the captured params, or null on no match.
- A boolean convenience wrapper for the common "is it active" check.
- A `<NavLink>` that applies an active/inactive class (and `aria-current`) automatically.
- Match against the **same route grammar** the router already uses (`:param`, `*`, `+`, `?`), so behavior is consistent with `<Route path>` and `defineRoutes`.
- Reactive on navigation and correct under SSR with no extra wiring.
- Dogfood by migrating `DocsLayout` off its hand-rolled logic.

## Non-goals (YAGNI)

- Search-param matching (a `search` option). Addable later as an option.
- Render-prop / function-of-active forms for `NavLink` (`children={(active) => ...}` or `class={(active) => ...}`). Explicitly cut; the hook is the escape hatch for anything beyond a class swap.
- Hash matching.
- `NavLink` as a general programmatic-navigation `Link`. It renders a plain `<a href>` and relies on preact-iso's existing global click interception, like every other link in the framework.

## Building blocks (already present)

1. **`exec(url, route, matches?)`** from `preact-iso` (re-exported via `preact-iso/src/index.js` → `router.js`). Splits a path against a pattern using the same grammar as `<Route path>`, fills `matches.pathParams` with captured params, and returns the `matches` object (truthy) or `undefined` on no match. preact-iso's own types label it "largely an internal API, it may change in the future"; see the dependency decision below.
2. **`useLocation().path`** from preact-iso (already re-exported by `@hono-preact/iso`). Trailing-slash-normalized, query-stripped pathname. Because it is a context consumer that updates on every navigation, anything built on it re-renders/re-highlights automatically and resolves during SSR under the existing `LocationProvider`.

## Public surface

```ts
interface RouteMatchOptions {
  /** When false, also match descendant paths (segment-prefix). Default true. */
  exact?: boolean;
}

/** Captured params when the current path matches `route`, else null. */
function useRouteMatch(route: string, options?: RouteMatchOptions): Record<string, string> | null;

/** Boolean convenience: `useRouteMatch(route, options) !== null`. */
function useRouteActive(route: string, options?: RouteMatchOptions): boolean;

interface NavLinkProps extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'class' | 'className'> {
  href: string;
  /** Pattern to test for active state. Defaults to `href`. */
  match?: string;
  /** Default true. */
  exact?: boolean;
  /** Always applied. */
  class?: string;
  /** Merged in when active. */
  activeClass?: string;
  /** Merged in when not active. */
  inactiveClass?: string;
}
function NavLink(props: NavLinkProps): JSX.Element;
```

Naming: `useRouteActive` (boolean) and `useRouteMatch` (params) chosen over the originally-floated `useIsRouteActive`; `useRouteMatch` deliberately pairs with the existing `useRoute`.

## Matching semantics

- **Grammar is the router's grammar.** `route` accepts the same patterns as `<Route path>` / `defineRoutes`: `/posts/:id`, `/files/*`, `:x?`, `:x+`. `useRouteMatch('/posts/:id')` is truthy on `/posts/123` and returns `{ id: '123' }`.
- **`exact` (default true):** full structural match, all segments consumed. `/posts/:id` matches `/posts/123`, not `/posts/123/edit`.
- **`exact: false`:** also matches descendants (segment-prefix). `/docs/components` is active on `/docs/components/dialog`. This is the area-tab case.
- **Pathname only.** Matching ignores `?query` and `#hash` because `useLocation().path` already excludes them. Trailing slashes on the `route` argument are ignored too (`exec` splits on `/` and drops empty segments). Root `/` matches only when the path is `/`.
- **Reactive + SSR-safe** by construction, via `useLocation`.

## `NavLink` behavior

- **Class merge:** final class is `[class, active ? activeClass : inactiveClass]` filtered and space-joined. Base `class` always applies; plain concatenation, no overwrite rules.
- **`aria-current="page"`** is set automatically when active. If the caller passes their own `aria-current`, that wins.
- **Anchor passthrough:** every other prop (`rel`, `target`, `data-*`, `onClick`, …) spreads onto the `<a>`. `NavLink` adds no navigation handler; preact-iso's in-scope click interception performs SPA navigation, consistent with all existing links.
- **`match` defaults to `href`:** common case is `<NavLink href activeClass inactiveClass>`. Set `match` when the link target differs from the active pattern (e.g. link to `/posts`, active for `/posts/:id`).

## Implementation

- New files:
  - `packages/iso/src/route-active.ts`: `useRouteMatch`, `useRouteActive`, `RouteMatchOptions`, and an internal `matchPath` wrapper.
  - `packages/iso/src/nav-link.tsx`: `NavLink`, `NavLinkProps`.
- Exported from `packages/iso/src/index.ts`; surfaced through the `hono-preact` umbrella the same way the other iso hooks are. **Not** added to the `/page` subpath, which is the server-outcome kitchen sink; these are client-render primitives.
- `matchPath(path, route, exact)` is the single chokepoint over `exec`:
  - exact mode returns `exec(path, route)`;
  - nested mode returns the exact match OR `exec(path, route + '/*')` (the `*` form requires at least one extra segment, so "exact OR strictly-nested" = "this route or any descendant").
- `useRouteMatch` returns `matched.pathParams ?? null`. `pathParams` is already `Record<string, string>`, so the return type needs **no cast**.

### Dependency decision: reuse `exec` vs vendor a matcher

preact-iso's types call `exec` "largely an internal API, it may change."

- **(A, chosen) Reuse `exec`,** wrapped in `matchPath`. DRY, and matching is guaranteed identical to the router's, which is the entire value proposition. The framework already pins preact-iso to a specific git tarball and depends on its internals elsewhere; the surface is controlled, and a breaking change to `exec` is a one-function fix.
- **(B) Vendor a ~15-line segment matcher.** Fully insulated but duplicates the router grammar and can silently drift, the worse failure mode for an active-route primitive.

Chosen: **A**, isolated behind `matchPath` so there is exactly one place to change if `exec` ever moves.

### Optional refinement (not blocking)

`useRouteMatch<P extends string>(route: P)` could return typed params derived from the literal via preact-iso's `RoutePropsForPath<P>['params']` instead of `Record<string, string>`, giving typed param keys with no cast. Adopt only if that type imports cleanly and stably; otherwise ship `Record<string, string>`.

## Dogfood: migrate `DocsLayout`

Replace the hand-rolled active logic in `apps/site/src/components/DocsLayout.tsx`:

- Sidebar entries → `<NavLink href={entry.route} exact activeClass=... inactiveClass=...>`.
- Area tabs → `<NavLink href={area.basePath} match={area.basePath} exact={false} activeClass=... inactiveClass=...>`.

Removes the `entry.route === path` and `path.startsWith('/docs/components')` hand-coding and proves both match modes against real UI. (The `activeAreaId` derivation that selects which area's sidebar to render is separate page logic and stays.)

## Testing

- **Hooks / `matchPath` unit** (rendered under `LocationProvider`): exact hit, miss, param capture (`/posts/:id` → `{ id }`), nested matches descendant while exact does not, root `/`, trailing-slash on both the route arg and the path, `*` wildcard. Plus a reactivity test: navigate and assert the result flips (drive the location change inside `act()`).
- **`NavLink`:** applies `activeClass` when active and `inactiveClass` otherwise, merges the base `class`, sets `aria-current="page"` only when active, forwards `href` and arbitrary anchor props (`rel`, `target`, `data-*`), `match` overrides `href`, and `exact={false}` matches a descendant.

## Docs

New Guide-area page under "Pages & Routing" at `/docs/active-links`, added to `apps/site/src/pages/docs/nav.ts`. Created by following the local `add-docs-page` skill. Covers the three exports, exact-vs-nested, and the `DocsLayout` example.

## Risks

- **`exec` instability** (mitigated by the `matchPath` chokepoint and the pinned preact-iso tarball).
- **Nested-mode edge cases** with patterns that already end in a wildcard/quantifier (e.g. a `route` ending in `*` or `:x+`). Covered by tests; if a combination is ambiguous, document it rather than special-casing.
</content>
</invoke>
