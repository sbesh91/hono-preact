# Single-source page guards (Section C primitive #5)

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan
**Section C primitive:** #5 of 6 (the highest-value, security-adjacent one)

## Problem

A protected page is gated in two independent places that must be kept in sync by
hand:

| Request path | Gated by | Declared in |
| --- | --- | --- |
| SSR render + client nav + hydration | `definePage(View, { use })` | the page `.tsx` |
| Loaders RPC (`POST /__loaders`) | `export const pageUse` | the `.server.ts` |
| Action POST | `export const pageUse` | the same `.server.ts` |

The render side reads `use` from `definePage`; the RPC side reads `pageUse` from
the `.server.ts` module via `makePageUseResolvers`. They come from different
sources, so they can drift. The auth hole: add a `.server.ts` with
`serverLoaders` but forget `export const pageUse = requireSession`, and the
loader/action RPC endpoint serves data unauthenticated even though the page
render redirects. The flagship app keeps the two in sync across three page pairs
purely by discipline; `apps/site/src/demo/guard.ts` documents the convention in
prose, which is the tell that the framework is missing a primitive.

## Goal

Make the route node the single declared source of a page-layer guard. One `use`
on a node gates that node's view (if any) and every descendant, on all of:
SSR render, client navigation, hydration, loader RPC, and action POST. The
render gate and the RPC gate read the same array, so they cannot drift. A
forgotten guard is structurally impossible because there is only one place to
declare it.

## Non-goals

- The app layer (`defineApp({ use })`) and the unit layer
  (`defineLoader/defineAction({ use })`) are unchanged. Only the page layer
  collapses. See "Considered and rejected" for why the app layer stays.
- The dead `loaderUse` / `actionUse` reserved exports are not removed here; that
  is Section D cleanup.

## Background: why the server/client middleware split makes this safe

Middleware is branded by environment: `defineServerMiddleware` (runs during SSR,
hydration prerender, and loader/action RPC; receives the Hono `Context`) and
`defineClientMiddleware` (runs only during intra-app navigation; receives a
minimal `{ scope, location }`). A single mixed array such as
`requireSession = [requireSessionServer, requireSessionClient]` is handed to
every surface, and each consumer filters by the `runs` tag:
`PageMiddlewareHost` runs server members during SSR and client members during
nav; the server resolvers run only server members.

The Vite `guard-strip` plugin (`packages/vite/src/guard-strip.ts`) rewrites every
wrong-env factory *call* into a no-op brand object: in the client bundle each
`defineServerMiddleware(...)` becomes
`{ __kind: 'middleware', runs: 'server', fn: (_ctx, next) => next() }`, so the
server body and any server-only modules it imports tree-shake out. Crucially,
stripping is keyed to the **definition site** (the call in `guard.ts`), not to
where the resulting array is referenced. Therefore referencing the guard array
from `routes.ts` is no worse for the client bundle than referencing it from a
page `.tsx` today: both pull in `guard.ts`, both get the server body neutralized
at its source. This is the mechanism that lets a single node `use` array feed
both the render path and the RPC path safely.

## Design

### 1. `use` on the route node

`RouteDef` gains `use?: PageUse` (the same mixed server+client middleware /
observer array type the page layer already accepts). It is eager data on the
node, so both consumers read it directly from the manifest. `definePage`'s `use`
option and the `.server.ts` `pageUse` export are both removed; the node is the
only place a page-layer guard is declared.

### 2. Inheritance is tree nesting

A node's `use` gates that node's own view and every descendant. Composition is
outer-to-inner, slotting into the existing chain order
`appConfig.use -> (ancestor node use, outer first) -> own node use -> unit use`.
Opt-out is purely structural: a route that must stay open (e.g. a login page) is
simply not a descendant of the guarded node. There is no per-node opt-out flag.

### 3. Render path

The route builder in `packages/iso/src/define-routes.tsx` wraps each
`use`-bearing node's rendered component in a `PageMiddlewareHost` seeded with
**that node's own** `use`. Because a layout group already renders its children
inside its own inner `<Router>`, nesting the hosts composes ancestor -> leaf
guards for free, on both SSR and client navigation, reusing the existing host
(Suspense/Deferred strategies, `runs` partitioning, redirect/deny/render
handling) unchanged.

- A leaf node with `use`: its view component is wrapped in a host.
- A layout-group or grouping node with `use`: the host wraps the group output, so
  the guard short-circuits before the section's chrome renders (a redirect
  renders null on the client / throws on the server before the layout mounts).

`definePage` keeps only `Wrapper` and `errorFallback`. The `Page` /
`PageMiddlewareHost` machinery stays; the route builder, not `definePage`,
supplies the `use` it runs.

### 4. Server RPC path

Today `makePageUseResolvers` lazy-loads each `.server.ts` to read `pageUse` and
walks server-bearing ancestors. With node `use`, the manifest precomputes a
`route-pattern -> composed use` view directly from the tree (static data; no
module load is needed to discover the guard), keyed off the **full** tree
ancestry rather than only server-bearing nodes (a guard can live on a layout or
grouping node that has no `.server.ts` at all, yet must gate its descendants'
RPC). `loadersHandler` and `pageActionHandler` keep their `resolvePageUse(path)`
parameter shape; the URL is matched to a pattern via the shared route matcher and
the composed array is run. The `.server.ts` `pageUse`-reading path
(`pageUseFromMod`, the non-array runtime backstop) retires.

### 5. The framework change this requires: `use` on a bare grouping

The site needs one guard covering the projects list plus the project-detail
section, which means a common guarded ancestor that excludes the public login and
index routes. The natural shape is a **bare grouping** node (children, no
layout/view) carrying `use`, sitting inside the `/demo` layout group. The current
validator forbids that: a path-grouping inside a layout group may only contain
view leaves (`define-routes.tsx:154`), because `buildInnerRoutes` does not recurse
into nested layouts/groupings at that depth.

This spec lifts that v0.1 restriction:

- `validate` allows `use` on any node and stops rejecting nested
  layouts/children inside a grouping.
- `buildInnerRoutes` and `flattenTree` recurse into a grouping's layout/children
  (not only its grandchild views), so a grouping that contains a nested layout
  group renders correctly.

The result: a guard becomes orthogonal to chrome. Wrapping a set of routes in a
guard no longer requires inventing a placeholder layout component.

### 6. Manifest changes

`RoutesManifest` gains the precomputed composed-`use` view the server resolver
consumes (e.g. an array of `{ path, use }` keyed by route pattern, or folded into
`serverRoutes`). The render builder needs no new manifest field; it reads
`node.use` from the tree it already walks. The phantom `__tree` carrier for typed
params is unaffected; `RoutePaths<typeof routeTree>` must continue to resolve on
the restructured tree.

### 7. Removals

- iso: `definePage`'s `use` option; the page-layer `use` plumbing that flowed
  from `definePage` into `Page`.
- server: `makePageUseResolvers` and `pageUseFromMod` in
  `route-server-modules.ts` (replaced by the manifest-driven lookup).
- vite: `pageUse` leaves the `.server.*` recognized-exports contract
  (`server-exports-contract.ts`); the `pageUse` parser/validation machinery
  (`findUseExports`/`hasNamedUseExport` usage for `pageUse`,
  `server-loader-validation` non-array `pageUse` check) is deleted. Guards now
  live as plain JS values in `routes.ts`, validated at runtime by `defineRoutes`,
  so no AST parsing is needed for them. (`loaderUse`/`actionUse` stay in the
  contract untouched per non-goals.)

## Site migration

The `/demo` tree restructures so the protected routes nest under one guarded
grouping node:

```ts
{ path: '/demo', layout: () => import('./pages/demo/demo-layout.js'), children: [
  { path: '',      view: () => import('./pages/demo/index.js') },                 // public
  { path: 'login', view: () => import('./pages/demo/login.js'),
    server: () => import('./pages/demo/login.server.js') },                       // public
  { path: 'projects', use: requireSession, children: [                           // one guard
    { path: '',           view: () => import('./pages/demo/projects.js'),
      server: () => import('./pages/demo/projects.server.js') },
    { path: ':projectId', layout: () => import('./pages/demo/project-layout.js'), children: [
      { path: '',                view: () => import('./pages/demo/project-issues.js'),
        server: () => import('./pages/demo/project-issues.server.js') },
      { path: 'issues/:issueId', view: () => import('./pages/demo/issue.js'),
        server: () => import('./pages/demo/issue.server.js') },
    ]},
  ]},
]}
```

- One `use: requireSession` gates the projects list, the project layout, and the
  issue page. `login` and the `/demo` index stay open by being outside the node.
- All three `.server.ts` files lose their `export const pageUse`.
- All three page `.tsx` files lose their `definePage({ use })` argument.
- `apps/site/src/demo/guard.ts` is unchanged; `requireSession` is now imported by
  `routes.ts` instead of by the individual pages.
- The matched URLs are unchanged (`/demo/projects`,
  `/demo/projects/:projectId`, `/demo/projects/:projectId/issues/:issueId`), so
  typed route params resolve the same shapes.

## Considered and rejected

### Collapsing `defineApp({ use })` into a root-node `use`

Rejected. Top-level routes are siblings, not descendants of `/`, so app-wide
coverage from the tree would require nesting the whole tree under one root
grouping, and "global" would then depend on every top-level route being
correctly nested. That reintroduces the forget-to-nest hole at the app layer,
where opt-out-by-position is a bug rather than a feature (request logging,
tracing, and global auth-context setup must never be escapable). `defineApp` also
carries `speculation` and is the home for future app config, so moving `use` out
would fragment app config across two files. The clean model keeps both:
`defineApp.use` is universal and topology-independent; node `use` is scoped and
opt-out-by-position.

### Guarded layout group instead of a bare grouping (option a)

Rejected as the primary approach. Making `projects` a layout group is legal today
with no framework change, but it needs a layout component, and since there is no
real "projects area" chrome it would be a placeholder passthrough existing only
to hang the guard. Forcing a placeholder component to attach a guard is the
papercut this primitive should delete, so the bare-grouping change (section 5) is
preferred. The layout-group form remains available to users who do want section
chrome.

## Testing strategy

- **iso render:** node `use` inheritance via nested hosts (outer-to-inner order;
  a layout/grouping-node guard short-circuiting before its subtree renders, on
  both SSR and client nav; redirect/deny/render outcomes); the new grouping shape
  through `validate`; `buildInnerRoutes`/`flattenTree` recursion into a grouping
  with a nested layout child; typed-params still resolves on the restructured
  tree.
- **server:** composed-`use` lookup by URL, including a guard on a layout/grouping
  node with no `.server.ts` that gates a descendant's loader and action RPC;
  outer-to-inner composition with `appConfig.use` and unit `use`.
- **hole-closure regression:** a `.server.ts` with `serverLoaders` under a
  guarded node has its loader RPC gated with no `pageUse` export anywhere,
  demonstrating the drift class is structurally gone.
- **vite:** `server-entry` wires the manifest-driven resolver; the
  recognized-exports contract no longer lists `pageUse`; the removed parser paths
  are gone.
- **site:** the auth flow still redirects on render and on direct RPC hits, both
  for the projects list and for nested project/issue routes.

## Docs updates

- `apps/site/src/pages/docs/middleware.mdx`: rewrite the page-layer rows, the
  "Why two declarations" section, and "Nested routes compose down the tree"
  around node `use`. Remove `pageUse` references.
- Document `use` on the route node in the routing / layouts docs.
- Sweep `pageUse` mentions from other docs (`structure.mdx`, `actions.mdx`,
  `active-links.mdx`, `hono-middleware.mdx`).
- Per house style, describe what the API is, not what it replaced. No "formerly
  `pageUse`" migration breadcrumbs.
