# Auth Investigation: What v0.1 Must Ship So Users Can Add Login

**Date:** 2026-05-14
**Status:** Draft
**Scope:** v0.1 sequencing item 8 (`docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md` §11). Closes investigation flagged by GitHub issue #35.
**Stance:** The framework stays out of the way. No auth primitive, no `useSession()`, no built-in OAuth/JWT helpers. Identify only the smallest set of changes that unblock common auth patterns built directly on Hono.

## TL;DR

The current v0.1 surface blocks the most basic auth shape: a route can't read a cookie to decide whether the user is logged in. Loaders receive `{ location, signal }` (no Hono `Context`). Server guards receive `{ location }` (no Hono `Context`). Both need the request to do anything auth-shaped.

This spec identifies **two framework changes**, **three validation tasks**, and **one docs recipe page** as the full output of item 8. Each framework change spins out as its own GitHub issue; the recipe lands once both are in. A working demo login flow in `apps/app` is explicitly out of scope for this item.

## Why this investigation

`v0.1-framework-direction.md` §10 says "no auth primitive, guards are the surface; user wires the auth." That promise only holds if the user actually *can* wire it with what v0.1 ships. Today they can't:

| Auth need | Where it has to happen | What's available today | Gap |
|---|---|---|---|
| Read session cookie to gate a route | Server guard | `{ location }` only | No `c` → no `getCookie(c, 'session')` |
| Read session cookie to fetch user-scoped data | Loader | `{ location, signal }` only | Same |
| Issue/clear a session cookie | Action | Full `c` | None |
| Verify a JWT bearer on every request | Server guard or loader | No request access | Same as cookie case |
| OAuth callback handling | Normal Hono route in `api.ts` | Full Hono surface | None |
| CSRF on `<Form>` POSTs | Hono middleware on app | `<Form>` posts same-origin via `fetch` | Need to validate user middleware reaches `/__actions` |
| Signed cookies | Anywhere `c` is available | `hono/cookie`'s `getSignedCookie` | Same as above; depends on `c` reaching loaders/guards |
| Logout | Action | Full `c` | None |

Three rows are blocked by the same root cause: loaders and server guards don't see the request. Two more depend on validation. The remaining three already work.

Conclusion: the framework is in the way of basic auth in exactly two places. Fix those, validate three assumptions, write one recipe, ship.

## Framework Change A: Loader context exposes Hono `Context`

### Current

```ts
// packages/iso/src/define-loader.ts
export type LoaderCtx = {
  location: RouteHook;
  signal: AbortSignal;
};
```

The server dispatcher at `packages/server/src/loaders-handler.ts:129` invokes `loaderFn({ location, signal })`. The Hono `Context` is in scope at the call site (the handler is a Hono middleware) but is not forwarded.

### Change

```ts
import type { Context } from 'hono';

export type LoaderCtx = {
  c: Context;
  location: RouteHook;
  signal: AbortSignal;
};
```

Dispatcher passes `c` straight through. No narrowing wrapper, no curated subset; the same `Context` actions already receive.

The pre-existing `SerializedLocation` validation path (`packages/server/src/loaders-handler.ts:58-69`) is unchanged. The new `c` field rides alongside.

### Asymmetry note

Actions receive `{ c, signal }` (no `location`). Loaders will receive `{ c, location, signal }`. The shapes do not merge; `location` is meaningful for loaders (URL params and search) and irrelevant for actions (the URL is part of the action call, not the matched route). The asymmetry is intentional.

### SSR path

Loaders also run during server-rendered first paint via `packages/iso/src/internal/loader-runner.ts:65` (the direct-fn path), distinct from the RPC dispatcher at `packages/server/src/loaders-handler.ts:129`. The implementation plan must thread `c` through both. Two viable mechanisms:

- Pass `c` as a function argument from the server entry down into `runLoader`.
- Stash `c` in the existing `runRequestScope` (`packages/iso/src/cache.ts:44`) AsyncLocalStorage, retrieve inside the runner.

The first is more explicit; the second matches how request-scoped cache state already flows. Pick during planning, not in this spec.

### Convention, not enforcement

By convention loaders are read-shaped: they read state, return data, and do not write response headers or set cookies. The runtime does not enforce this. A loader that calls `setCookie(c, ...)` will succeed if response headers haven't been flushed yet. The docs note the convention. The framework does not police it.

### Migration

Loader call sites in the demo (`apps/app/src/views/*.server.ts`) destructure `{ location }` or take no args; adding a field to `LoaderCtx` does not break them. Users who imported `LoaderCtx` directly get a wider type; that is the only TS-visible change.

## Framework Change B: Server guard context exposes Hono `Context`; client guard context does not

### Current

```ts
// packages/iso/src/guard.ts
export type GuardContext = {
  location: RouteHook;
};

export type GuardFn = {
  readonly runs: GuardRunsOn;
  readonly fn: (ctx: GuardContext, next: () => Promise<GuardResult>) => Promise<GuardResult>;
};

export const defineServerGuard = (fn: GuardFn['fn']): GuardFn => ({ runs: 'server', fn });
export const defineClientGuard = (fn: GuardFn['fn']): GuardFn => ({ runs: 'client', fn });
```

### Change

Split the context type per environment, matching the "environment encoded in the factory" stance from the single-guards-list spec (`2026-05-13-single-guards-list-design.md`).

```ts
import type { Context } from 'hono';

export type ServerGuardContext = {
  c: Context;
  location: RouteHook;
};

export type ClientGuardContext = {
  location: RouteHook;
};

export type ServerGuardFn = {
  readonly runs: 'server';
  readonly fn: (ctx: ServerGuardContext, next: () => Promise<GuardResult>) => Promise<GuardResult>;
};

export type ClientGuardFn = {
  readonly runs: 'client';
  readonly fn: (ctx: ClientGuardContext, next: () => Promise<GuardResult>) => Promise<GuardResult>;
};

export type GuardFn = ServerGuardFn | ClientGuardFn;

export const defineServerGuard = (fn: ServerGuardFn['fn']): ServerGuardFn => ({ runs: 'server', fn });
export const defineClientGuard = (fn: ClientGuardFn['fn']): ClientGuardFn => ({ runs: 'client', fn });
```

The previous shared `GuardContext` name is removed; downstream code that imported it switches to one of the two specific names (no such call sites exist in the demo today).

### Runtime

`runGuards` (`packages/iso/src/guard.ts:34`) calls `guards[i].fn(ctx, ...)`. The runtime constructs a context with the right shape per environment:

- Server SSR / route resolution: build `ServerGuardContext` with `c` from the active Hono context.
- Client navigation: build `ClientGuardContext` with `location` only.

Already-filtered guards (per the env filter in `internal/guards.tsx`) never see a context shape they don't expect because the filter and the context construction agree on the environment.

### Migration

The demo has zero `defineServerGuard` / `defineClientGuard` call sites today (guards are not used in `apps/app`). The migration risk is contained to the framework's own internals and the docs.

## Validation tasks (executed during recipe authoring)

These are open questions about the current code that the investigation must answer before the recipe is final. If any answer is "no," that becomes a separate framework gap and ships as its own follow-up issue.

### V1. User-level Hono middleware reaches `/__actions` and `/__loaders`

Question: if the user does `app.use('*', csrf({ origin: ['https://example.com'] }))` on the Hono app they pass to the framework, does that middleware run before `actionsHandler` and `loadersHandler`?

Why it matters: if yes, CSRF is a documentation problem (recipe says "drop in `hono/csrf`, you're done"). If no, the framework's route-mount path needs a fix so user middleware composes naturally.

How to validate: read the server-entry composition path in `packages/server/src` (and the framework's generated server entry). Wire a small fixture middleware that logs on hit, mount under user app, fire a `<Form>` POST, observe.

### V2. `c.env` is populated inside loaders and guards on Workers

Question: does `c.env.MY_KV` return a real binding inside a loader when running on Cloudflare Workers (the only deploy target at v0.1)?

Why it matters: session lookups, cookie secrets, JWT verification keys all live in env bindings. If `c.env` is empty in the dispatcher's context, the recipe falls apart.

How to validate: write a one-line loader that returns `Object.keys(c.env)`, run via `wrangler dev` with a fake binding, confirm.

### V3. A loader can set a response cookie

Question: if a loader calls `setCookie(c, 'session', newToken)`, does that cookie make it onto the response sent to the browser?

Why it matters: "rotate session on every read" and "first-paint cookie issuance" are real patterns. If response headers are already serialized by the time the loader runs (likely for a streaming SSR or for client-driven loader fetches), this pattern is broken and the recipe must say so.

How to validate: write a loader that sets a cookie, fetch the loader endpoint over HTTP, inspect `Set-Cookie` on the response. Repeat for the SSR path.

Each of V1, V2, V3 has a single "yes / no / partial" outcome. The recipe is written assuming "yes" for V1 and V2; V3 outcome dictates which paragraph of the recipe says "this works" vs "this does not work in v0.1, do it from an action instead."

## Recipe: `docs/auth.mdx`

One docs page, written against the post-change API. Pattern: each section is short, opinionated, and points at Hono's docs for the heavy lifting.

### Section 1: Session cookies (primary example)

Walks through a full login round-trip:

- Login form (`<Form>` posting to a `serverActions.login` action).
- Action reads `email`/`password` from the form, validates, calls `setSignedCookie(c, 'session', token, { httpOnly: true, ... })`.
- A `defineServerGuard` reads the cookie via `getSignedCookie(c, secret, 'session')` and `return { redirect: '/login' }` when missing.
- A loader on a protected route uses the same cookie read to load user-scoped data.
- Logout action calls `deleteCookie(c, 'session')` and returns a redirect.

All four pieces (form, action, guard, loader) appear in the recipe with copy-paste-ready code.

### Section 2: JWT bearer

One subsection, ~15 lines: replace `getCookie(c, 'session')` with `c.req.header('authorization')?.replace(/^Bearer /, '')` and `verify` from `hono/jwt`. Same guard/loader shape otherwise.

### Section 3: OAuth callback

Three sentences and a pointer: this is a normal Hono route in `api.ts`, not a framework concern. Link to Hono's OAuth docs. The framework's only contribution is that after callback you can call `setSignedCookie(c, ...)` and the next loader/guard sees it.

### Section 4: Signed cookies

One paragraph: use `getSignedCookie` and `setSignedCookie` from `hono/cookie`. Secret comes from `c.env.SESSION_SECRET`. Available in actions, loaders, and server guards.

### Section 5: CSRF on `<Form>`

Recipe: `app.use('*', csrf({ origin: ['https://yourapp.com'] }))` on the user's Hono app. `<Form>` POSTs include the `Origin` header automatically (same-origin fetch); cross-origin attackers fail the check.

Caveat sentence on token-based CSRF: not supported via `<Form>` at v0.1; use `useAction` with a custom client if needed.

### Section 6: Logout

Eight lines: an action that calls `deleteCookie(c, 'session')` and returns `{ redirect: '/login' }` (or the framework's equivalent action-return-redirect shape).

### Section 7: What this page does NOT provide

Brief callout: no `useSession()` hook, no `<AuthProvider>`, no token issuance helper. Use Hono's primitives directly. If you find yourself wanting one of these, file an issue with the use case.

## Out of scope (confirmation of v0.1-direction §10)

- `useSession()` hook or any client-side auth-state primitive.
- Built-in OAuth provider adapters.
- JWT issuer/verifier wrappers (use `hono/jwt` directly).
- Token-based CSRF support on `<Form>`. Users needing it use `useAction` with their own fetch headers.
- Layout-level guards (already covered by `v0.1-framework-direction` §1).
- A worked auth flow in `apps/app/src/views/`. The recipe is the deliverable; the demo flow is a separate item if it gets prioritized at all.
- Merging server/client guards or making `defineGuard` unified. Already settled by `2026-05-13-single-guards-list-design.md`.
- Changing the action context shape. Actions already receive `{ c, signal }`; that stays.

## Sequencing

This investigation produces an implementation plan that breaks into three discrete pieces. They are independent enough to ship in any order, but the recipe is the integration test for both framework changes.

1. **Framework change A** (loader `c`). Edits to `packages/iso/src/define-loader.ts` (type), `packages/server/src/loaders-handler.ts:129` (RPC dispatcher), `packages/iso/src/internal/loader-runner.ts:65` (SSR direct-fn path), plus the chosen threading mechanism (function arg vs. AsyncLocalStorage). Tests for the new field's presence; validation tasks V2 + V3 executed against this branch.
2. **Framework change B** (server guard `c`). Edits to `packages/iso/src/guard.ts` (types, factory return shapes) and `packages/iso/src/internal/guards.tsx` (context construction per environment) plus the SSR-side guard runner if separate. Tests for the type split. No demo migration needed (zero guard call sites in `apps/app`).
3. **Recipe** (`docs/auth.mdx`). Written against the API from items 1 and 2. Validation task V1 (Hono middleware reach) executed against the recipe's CSRF section as the live integration test.

Items 1 and 2 each become a GitHub issue. The recipe is a third issue. The launch README references the recipe; the recipe must exist before item 10 (launch) begins.
