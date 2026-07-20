# Action-scope location for route middleware (#288)

Status: design approved via brainstorming, ready for an implementation plan.
Issue: #288 (P1, framework-api). Milestone: v0.12.
Branch: `worktree-288-action-scope-location`.

## Problem

Route-node `use` middleware is scope-agnostic: the same guard array runs for
page, loader, and action requests, discriminated on `ctx.scope`. `ServerPageCtx`
and `ServerLoaderCtx` both carry `location: RouteHook` (`{ path, pathParams,
searchParams }`), but `ServerActionCtx` carries only `{ c, signal, scope, module,
action, payload }` (`packages/iso/src/define-middleware.ts:24-29`). A per-resource
guard keyed on `ctx.location.pathParams` therefore has nothing to read in the
action arm and must pass every action through.

Concretely (the #288 case): the demo's archived-project gate
(`apps/site/src/demo/archived-gate.ts`) renders a notice for the page, denies 410
for loaders, and skips actions. A signed-in user can still mutate an archived
project's tasks by invoking the action RPC directly. The "read-only" state is
advisory for actions. The docs already ship this as a known caveat
(`apps/site/src/pages/docs/middleware.mdx`).

## Goal and non-goals

Goal: give route-bound actions a route-authoritative `location` on the guard ctx
so a route-node guard can gate action scope exactly as it gates page and loader
scope, and close the demo's read-only bypass end to end.

Non-goals (explicit, each a separate concern):

- Typed route params on the action *body* ctx (`ActionCtx`). This is the
  separable "Option 2" ergonomic (mirror route-bound `LoaderCtx`'s typed
  `location` through the `serverRoute(r).action` overloads). It reverses the
  documented "an action's ctx exposes no route params" stance and widens the
  `call()` soundness wart, so it ships as a follow-up issue, not here. This spec
  touches only the guard/middleware ctx.
- Task-ownership authorization. The gate protects by the URL's project, not by
  whether a payload's `taskId` belongs to that project. A user on an active
  project's page who POSTs a `taskId` belonging to an archived project is not
  blocked by this gate. That is a per-action ownership check the action bodies
  would own separately. #288 is specifically the "POST to the archived project's
  URL" bypass.
- Bare (route-independent) actions. A bare `defineAction` deliberately gets
  `EMPTY_PAGE_USE` and no page tier so a client cannot pick which route's guards
  apply by choosing where to POST (`page-action-resolvers.ts:60-68`). Route-node
  middleware fundamentally cannot gate a bare action, and this fix does not change
  that. Bare actions get no location.

## Background: two ctx surfaces, and how location is derived today

There are two ctx objects per scope, built separately:

- Guard ctx: `ServerActionCtx` (`packages/iso/src/define-middleware.ts:24-29`),
  received by route-node `use` middleware. This is the fix target.
- Body ctx: `ActionCtx` = `{ c, signal, call }` (`packages/iso/src/action.ts:38-42`),
  received by the action fn. Out of scope (see non-goals).

Route-bound loaders are the precedent: `ServerLoaderCtx` (guard ctx) carries an
untyped `RouteHook`, and `LoaderCtx` (body ctx) carries a typed `location`. Note
that the loader RPC's `location` comes from the *client JSON body* and is
explicitly documented as non-authoritative for guards
(`packages/server/src/loaders-handler.ts:103-125`). We do not copy that.

Key facts that make the fix tractable and *stronger* than the loader path:

- Actions POST to the current page URL (`window.location.pathname + search`,
  `packages/iso/src/action.ts:503-506`; `form.tsx` for the `<Form>` and no-JS
  paths). There is no dedicated action endpoint. So the invoking page URL is the
  request URL in every request shape.
- The handler already has both halves it needs, unused: `urlPath = new
  URL(c.req.url).pathname` (`page-actions-handler.ts:262`) and `entry.routeId`
  (the boot-validated declared pattern, present for `serverRoute(r).action`,
  `page-action-resolvers.ts:18,53`).
- So action `pathParams` can be derived server-side with authoritative *keys*
  (from the boot-validated pattern) and URL-segment *values*. This is the same
  trust posture as the socket upgrade (`socket-resolution.ts`), and strictly
  stronger than the client-supplied loader RPC location.

## Design

### 1. Public API: optional `location` on `ServerActionCtx`

Add `location?: RouteHook` to `ServerActionCtx`
(`packages/iso/src/define-middleware.ts:24-29`). Optional because bare actions and
the in-process `call()` path have no authoritative route. This is an additive,
non-breaking public-type change: existing action-scope middleware keeps
compiling; new guards read `ctx.location?.pathParams`.

### 2. Server-side derivation (`page-actions-handler.ts`)

At the point where the ctx is built (`~337-344`), for a route-bound action
(`typeof entry.routeId === 'string'`):

- Derive `pathParams` by matching the POST `urlPath` against `entry.routeId`
  using iso's `exec`-based matcher in non-exact mode (see section 3). Non-exact
  so an action bound to `/a/:x` still captures `x` when POSTed from a descendant
  URL `/a/p/b/q` (the resolver includes ancestor actions in a descendant route's
  map; the POST URL can be deeper than the binding pattern).
- On a match: set `location = { path: urlPath, pathParams, searchParams }` where
  `searchParams` comes from `new URL(c.req.url).searchParams`.
- On no match: deny (section 4).

For a bare action (`entry.routeId` undefined): leave `location` undefined. Bare
actions never run a route-node page tier anyway, so no guard reads it.

The second construction site, `packages/iso/src/server-caller.ts:201-208` (the
in-process `call()` RPC), leaves `location` undefined. It compiles because the
field is optional. Route-node guards do not run on the `call()` path (only
`ref.use`), so there is no location to derive and nothing to gate there; this is
existing behavior and is documented (section on `call()`).

### 3. Extractor: reuse iso's `exec`-based matcher (no new server matcher)

The server package (`packages/server`) already depends on `@hono-preact/iso`
(`workspace:*`) and `page-actions-handler.ts` already imports from
`@hono-preact/iso`, `/internal`, and `/internal/runtime`. iso already wraps
preact-iso's `exec` into `matchPath(path, route, exact)` and a private
`execParams(path, route)` (`packages/iso/src/route-active.ts:14-41`), returning
`Record<string, string> | null`.

`packages/server/src/route-pattern.ts` re-implements the same grammar as a
*boolean* matcher, and its own doc says it does so specifically to "agree with the
client router". It is boolean-only because its callers (page-use resolution via
`findBestPattern`) never needed param *values*. So capturing params via `exec` is
not crossing a deliberate boundary; it uses the matcher the server already
promises to mirror, and guarantees a route guard sees exactly the params the
client router computes for the same URL (a correctness property for
authorization, not a nicety).

Plan: expose a pure matcher from iso's `internal/runtime` barrel (the surface the
server already imports from) so `page-actions-handler.ts` can call it. Prefer
extracting the existing private `execParams`/`matchPath` logic into a shared
`internal` module and exporting it, so there is exactly one param-capture
implementation shared by `route-active.ts` (client) and the action handler
(server). Do not add a second capture implementation in `route-pattern.ts`.

Grammar consequence: `exec` uses the wide grammar (hyphenated params such as
`:board-id` bind), matching the client router. No change to
`assertConformingBoundRouteId` (currently socket/room-scoped) is needed for
actions; action param extraction follows the client router's grammar. (The socket
path's narrower `parseKeyParams` grammar is a separate socket concern, unchanged.)

### 4. Deny on mismatch (Decision 1a)

If a route-bound action's POST URL does not match its `routeId` (even non-exact),
deny at the framework level before dispatching the middleware chain, mirroring the
socket upgrade's 4403. This means a route-bound action cannot be invoked from
outside its bound subtree, closing the "dodge the gate by POSTing from a different
URL" bypass without depending on every gate author writing fail-closed logic.

In practice this is a defensive backstop: `byPath` resolution already ties an
action's resolution to a pattern that matches the URL, so a resolved route-bound
action's URL normally matches its `routeId` (exactly or via ancestor inclusion +
non-exact). The deny covers anomalous/crafted requests. Use a clear deny status
(proposed: 403; final status is an implementation detail to settle in the plan)
and a message naming the bound pattern.

### 5. Trust model (summary)

Action `location.pathParams`: keys from the boot-validated `routeId` pattern,
values from the already-matched POST URL. Route-authoritative, strictly stronger
than the loader RPC's client-supplied location. Never sourced from the request
body. Do not reuse `validateLocation`.

## Demo adoption (closes the concrete case end to end)

The archived-project subtree is `/demo/projects/:projectId` with
`use: archivedGate` on the `:projectId` node (`apps/site/src/routes.ts`).

- Task-detail actions are already route-bound: `task.server.ts`'s `addComment`
  and `setStatus` use `route.action(...)` bound to
  `/demo/projects/:projectId/tasks/:taskId`, and already inherit `archivedGate`.
  They need no change; the framework fix alone gives them a location, and the gate
  update (below) starts gating them. This is direct evidence the fix is the right
  shape (the file's own comment prefers `route.action` "rather than fuzzy-matching
  the POST URL").
- Board actions are bare and need conversion: in
  `apps/site/src/pages/demo/project-board.server.ts`, change `createTask`,
  `patchTask`, `deleteTask`, `restoreTask` from `defineAction(fn, opts)` to
  `route.action(fn, opts)` (the `route = serverRoute('/demo/projects/:projectId')`
  binding already exists in the file for its loaders). Drop the now-unused
  `defineAction` import. These four are invoked only from board-page components
  (`Board.tsx`, `NewTaskDialog.tsx`), so they resolve cleanly from the board URL.
- Gate update: in `apps/site/src/demo/archived-gate.ts`, `archivedOutcomeFor`
  returns `deny(...)` for action scope (an archived project is read-only for
  mutations too), and `archivedGateServer` reads `ctx.location.pathParams.projectId`
  for the action arm the same way it does for loaders. Any action reaching this
  route-node gate is route-bound and therefore has a location (bare actions never
  run route-node middleware), so the read is safe. Choose a deny status for a
  blocked mutation (proposed: 409 or 403; the loader uses 410 Gone).

## Docs

- Rewrite the `middleware.mdx` caveat: action scope now carries a
  route-authoritative `location` for route-bound actions; a per-resource
  route-node gate covers renders, loaders, and route-bound actions. Note the two
  remaining gaps honestly: bare actions are not route-gated (bind them or use a
  unit-level `use`), and the in-process `call()` path bypasses route-node guards.
- Sweep for any other doc asserting actions are location-less (the loaders/actions
  scope discussion, the `serverRoute(r).action` docstring in
  `packages/iso/src/server-route.ts:117-127`, and the action-body "enforce inside
  the action body" guidance). Per repo convention, docs describe current behavior
  with no migration breadcrumbs.

## Testing

- Type-level (`packages/server/src/__tests__/compose-server-chain.test-d.ts`): add
  a positive assertion that `ServerActionCtx` carries an optional `location`; keep
  the existing `ServerCtx<'action'>` equality assertions.
- Unit (`page-actions-handler.test.ts`): a route-bound action receives a
  `location` with pathParams derived from the POST URL and its `routeId`; a bare
  action receives no `location`; a route-bound action whose POST URL does not match
  its `routeId` is denied.
- Integration (`middleware-chain.test.ts`): a route-node guard denies a route-bound
  action to an archived resource, and passes it for an active one; the same guard
  still leaves middleware/loader behavior unchanged.
- Demo (`apps/site/src/demo/__tests__/archived-gate.test.ts`): the assertion that
  actions pass through flips to "actions on an archived project are denied"; add
  the active-project pass case.
- The `call()` path keeps working with `location` undefined (no route-node guard
  runs there).

## Files touched (checklist for the plan)

Framework:
- `packages/iso/src/define-middleware.ts` (add `location?` to `ServerActionCtx`)
- `packages/iso/src/route-active.ts` + a shared `internal` module (extract/export
  the param-capture matcher)
- `packages/iso/src/internal-runtime.ts` (export the matcher from the runtime barrel)
- `packages/server/src/page-actions-handler.ts` (derive + populate `location`, deny
  on mismatch)
- `packages/iso/src/server-caller.ts` (leave `location` undefined; compiles via optional)

Demo + docs + tests:
- `apps/site/src/pages/demo/project-board.server.ts` (bare -> `route.action` x4)
- `apps/site/src/demo/archived-gate.ts` (deny for action scope)
- `apps/site/src/pages/docs/middleware.mdx` (+ any other location-less-action docs)
- `packages/iso/src/server-route.ts` (docstring)
- Tests listed above.

## Public API / breaking-change assessment

Additive and non-breaking: `location` is optional on `ServerActionCtx`, so all
existing action middleware and the two construction sites keep compiling. New
capability, no removed or narrowed surface. Framework-side runtime behavior
change: a route-bound action POSTed from outside its bound subtree now denies
(was: ran); this is the intended security tightening and is documented.

## Resolved decisions

- Scope: guard ctx only (Option 1). Body-ctx typed params (Option 2) is a
  follow-up issue.
- Mismatch behavior: deny at the framework level (Decision 1a).
- Extractor: reuse iso's `exec`-based matcher, one shared implementation. No new
  matcher in `route-pattern.ts`.
- `location` optional; bare actions and `call()` get none.
- `searchParams` populated from the POST URL; grammar follows the client router
  (wide), no boot-conformance change for actions.
- Demo change lands in this PR (necessary for the concrete case).

## Follow-ups to file

- Option 2: typed route params on the action body ctx (`ActionCtx`) via the
  `serverRoute(r).action` overloads.
