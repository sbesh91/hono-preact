# Reserved-path middleware: mount the user app on top

**Date:** 2026-05-17
**Status:** design, approved
**Issue:** [#43](https://github.com/sbesh91/hono-preact/issues/43)
**Audit ancestry:** `docs/superpowers/research/2026-05-14-hono-primitives-audit.md` (`hono/csrf` row, recommendation 1)
**Related:** #44 (per-loader/action middleware — orthogonal, the RPC layer below HTTP dispatch)

---

## Problem

Users cannot apply HTTP-layer middleware to the framework's reserved paths,
`POST /__loaders` and `POST /__actions`. The motivating case is `hono/csrf`: an
app whose threat model needs explicit origin checking on `/__actions` has no way
to add it.

The generated server entry (`packages/vite/src/server-entry.ts`) registers the
reserved paths first, then mounts the user's app:

```ts
new Hono()
  .post('/__loaders', loadersHandler(serverModules, handlerOpts))
  .post('/__actions', actionsHandler(serverModules, handlerOpts))
  .route('/', userApp)          // user's api.ts
  .get('*', (c) => renderPage(c, ...));
```

The #36 audit and issue #43 attributed the gap to Hono "sub-app scoping." That
is imprecise. `app.route('/', userApp)` copies every route in `userApp` —
including `.use('*', …)` middleware, which is just an ALL-method route — onto
the parent at the mount path. Hono then matches **all** routes for a path and
composes the matched handlers **in registration order**.

So `csrf()` registered inside `api.ts` fails to protect `/__actions` purely
because of **order**: `/__actions` is registered first, so for a
`POST /__actions` the composed chain is `[actionsHandler, csrf]`. The actions
handler returns a `Response` without calling `next()`, and `csrf` never runs.

Verified against `hono@4.12.14` (five cases, see "Verification" below).

## Decision

**Mount the user app above the framework's handlers.** Flip the generated entry
so `api.ts` is registered before the reserved paths and the SSR catch-all. Then
`app.use('*', csrf())` in `api.ts` composes ahead of the reserved-path handlers
and protects them, by ordinary Hono semantics. No new framework API, no
auto-mounted default, no middleware-slot config.

This was chosen over two alternatives:

- **Auto-mount a default origin check on the reserved paths.** Rejected: it
  reverses the #36 audit's "do not pre-decide for the user" principle, and the
  audit recorded that decision explicitly three times. The reframe below honors
  the principle instead of overturning it.
- **A handler factory + bring-your-own-entry.** Rejected as #43's answer: it
  adds public API surface to solve a problem the reordering makes disappear. The
  existing `entry` plugin option remains as a separate full-BYO escape hatch for
  power users; it is not this issue's mechanism.

### Trade-off accepted

Reserved-paths-first was a structural guarantee that user code in `api.ts`
**cannot shadow** `/__loaders`, `/__actions`, or the SSR handler. Mounting the
user app on top removes that guarantee: a catch-all or a literal reserved-path
registration in `api.ts` now composes ahead of the framework handler and can
shadow it (verified, case 4).

We replace the structural guarantee with **build-time detection that fails the
build** for the unambiguous cases (see part 2). Dynamically-computed routes that
happen to collide remain a static-analysis blind spot; this is judged
acceptable because such routes are exotic and the deliberate cases are caught
hard.

### Bonus: app-wide middleware

Because `api.ts` now sits ahead of the SSR `GET *` handler too, a `.use('*', …)`
there runs on SSR page responses as well as RPC (verified, case 5). This
resolves, for free, the "app-wide middleware" need (`hono/secure-headers`,
`hono/logger`, request-id over the whole site) that the #43 investigation had
set aside as a separate concern. No separate mechanism is needed.

## Design

### 1. Entry reordering

In `generateServerEntrySource` (`packages/vite/src/server-entry.ts`), emit the
`api.ts` mount before the reserved paths:

```ts
export const app = new Hono()
  .route('/', userApp)          // emitted only when api.ts exists
  .post('/__loaders', loadersHandler(serverModules, handlerOpts))
  .post('/__actions', actionsHandler(serverModules, handlerOpts))
  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));
```

When no `api.ts` is present, output is unchanged (there is no `userApp` to
mount). This is the entire runtime change.

### 2. Shadow detection (`findApiCatchAllRoutes`, runs in `buildStart`)

Today the walker emits `this.warn` for catch-alls and `app.notFound()`. New
behavior:

| Pattern in `api.ts`                                              | Post-flip consequence                          | Severity                |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| Catch-all route — `get/post/put/patch/delete/options/head/all/on` with path `'*'` or `'/*'` | Composes ahead of reserved paths and/or SSR; shadows them | **build error** (`this.error`) |
| Literal `'/__loaders'` or `'/__actions'` registration, any method | Directly shadows the framework RPC handler     | **build error**         |
| `app.notFound(...)`                                              | Won't fire — the `GET *` SSR handler matches everything first; does not shadow RPC | **warning** (unchanged) |

`notFound()` stays a warning: a not-found handler only runs when no route
matches, and `renderPage` always matches, so it cannot break RPC. It silently
won't fire — the same advisory as today.

Two corrections to the walker while it is being changed:

- **`.on()` argument bug.** The walker inspects `arguments[0]` for the wildcard
  pattern. For `app.on(method, path, …)` the path is `arguments[1]`, so `.on()`
  catch-alls are currently missed. Detect the path at the correct index for
  `on` (it accepts `on(method, path, …)` and `on(method, path[], …)`).
- The warning/error message wording is updated: catch-alls and literal reserved
  paths now break RPC and/or SSR, not just "shadow renderPage."

`findApiCatchAllRoutes` is renamed to reflect the broader responsibility
(`findApiShadowingRoutes`); the `CatchAllWarning` type is renamed accordingly
and gains a `severity: 'error' | 'warning'` field, which the `buildStart`
caller switches on between `this.error(...)` and `this.warn(...)`.

### 3. Documentation

- **Actions / CSRF docs:** the origin-check recipe is `app.use('*', csrf())` in
  `api.ts`. Show it.
- **Reserved paths:** document `/__loaders` and `/__actions` as reserved, and
  the now load-bearing rule — do not register catch-alls or those literal paths
  in `api.ts`; the build will reject them.
- **App-wide middleware:** state explicitly that `api.ts` middleware runs ahead
  of both RPC and SSR, so `.use('*', …)` there is effectively app-wide.

### 4. Audit correction

Update `docs/superpowers/research/2026-05-14-hono-primitives-audit.md`:

- The `hono/csrf` row claims users can already "wrap the handler or use
  middleware composition" for `/__actions`. That was false when written. Replace
  it with the now-true mechanism: `app.use('*', csrf())` in `api.ts`.
- Recommendation 1 ("Do not auto-mount `hono/csrf` on `/__actions`") stands —
  add a note that #43 resolved the underlying gap by reordering, with no
  auto-mount, preserving the guiding principle.

## Out of scope

- **Per-loader / per-action middleware** (auth, validation, per-action rate
  limiting). That is the RPC layer, tracked in #44.
- **A handler factory or `createHandlers`-style API.** Not needed.
- **An auto-mounted default origin check.** Explicitly rejected (see Decision).
- **A new convention filename for a user-authored entry.** The existing `entry`
  plugin option is retained unchanged as the full-BYO escape hatch.

## Verification

Hono mount-order semantics, confirmed against `hono@4.12.14`:

1. User `.use('*')` mounted first → runs before a later-registered reserved
   path handler.
2. Reserved path first (today) → user `.use('*')` does not run for it.
3. A rejecting middleware (csrf-like) mounted first → returns 403, the
   reserved-path handler never runs.
4. A user catch-all mounted first → shadows the reserved path entirely.
5. User `.use('*')` mounted first → runs ahead of the `GET *` SSR handler.

## Testing

- `generateServerEntrySource`: asserts `.route('/', userApp)` is emitted before
  the `.post('/__loaders')` / `.post('/__actions')` lines; unchanged output when
  no `api.ts`.
- Shadow detection: build error for a catch-all (`all('*')`, `get('/*')`), for a
  literal `'/__actions'` / `'/__loaders'` registration, and for an `.on()`
  catch-all; `notFound()` still a warning.
- Integration: an `api.ts` with `app.use('*', csrf())`, a cross-origin
  `POST /__actions` is rejected with 403 and the action handler does not run; a
  same-origin `POST /__actions` succeeds.

## Acceptance

- [ ] Generated entry mounts `userApp` before the reserved paths and SSR
      catch-all.
- [ ] `api.ts` catch-alls and literal reserved-path registrations fail the
      build; `.on()` catch-alls detected; `notFound()` remains a warning.
- [ ] Docs cover the `csrf()` recipe, the reserved-path rule, and the app-wide
      reach of `api.ts` middleware.
- [ ] The #36 audit's `hono/csrf` row and recommendation 1 are corrected.
- [ ] Tests above pass.
