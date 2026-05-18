# Hono primitives + `@hono/*` packages: keep / replace / wrap audit

**Date:** 2026-05-14
**Status:** research, decision log
**Spec:** `docs/superpowers/specs/2026-05-09-v0.1-framework-direction.md` section 11, item 9
**Issue:** [#36](https://github.com/sbesh91/hono-preact/issues/36)
**Blocked by:** #35 (closed via PR #41)

---

## TL;DR

**Guiding principle:** Hono packages should work as normal on top of the framework. The framework's job is to *not get in the way* of Hono. A user adding `app.get('/ws', upgradeWebSocket(...))` to `apps/app/src/api.ts` today gets a working WebSocket route in Cloudflare Workers production with zero framework involvement (see section 2 for the composition pattern and section 6 for the WebSocket worked example). That's the bar: every Hono helper and `@hono/*` package should compose against the user's `Hono` app the same way it would in a stock Hono project.

Against that bar:

- **The framework already meets it for the entire `hono/*` and `@hono/*` surface.** User `api.ts` mounts ahead of the wildcard `renderPage`, plugins are scoped to framework-shaped files, and middleware composition follows standard Hono semantics.
- **One reimplementation is deliberate:** `runRequestScope` replaces `hono/context-storage`. The helper only stashes `c`; we need a per-request `Map` for the loader cache, with isomorphic semantics for the browser. Validated in PR #41 prework, recorded here.
- **One thin wrap already exists:** `streamSSE` wrapped by `sseGeneratorResponse` / `sseReadableStreamResponse` in `packages/server/src/sse.ts`. Users can still call `streamSSE` directly.
- **No `replace` rows.** No `wrap` rows to add. The earlier draft proposed auto-mounting `hono/csrf` on `/__actions`; on reflection that violates the guiding principle: users add `app.use(csrf())` on their `c.api` like normal Hono, and the framework should not pre-decide for them.
- **One ecosystem gap worth flagging (not framework-level):** `@hono/vite-dev-server` does not support WebSocket upgrade requests today. WS works in `wrangler dev` and Workers production; not in `vite dev`. Document, don't fix in v0.1.

---

## 1. How user code reaches Hono

`packages/vite/src/server-entry.ts:44-49` writes the generated production entry:

```ts
export const app = new Hono()
  .post('/__loaders', loadersHandler(serverModules))
  .post('/__actions', actionsHandler(serverModules))
  .route('/', userApp)              // user's apps/app/src/api.ts mounted here
  .use(location)
  .get('*', (c) => renderPage(c, ...));
```

What this means for "use Hono as normal":

- Anything the user registers on `userApp` (their `api.ts`) is mounted at `/` *before* the framework's wildcard `renderPage` handler. Specific routes always win. Catch-alls on user code are flagged at build time (`findApiCatchAllRoutes`, `server-entry.ts:84-157`) so users don't accidentally shadow themselves.
- The two reserved paths are `POST /__loaders` and `POST /__actions`. Users avoid them.
- `.use(location)` applies only to handlers registered after it: in this entry, only the wildcard `renderPage` sees it. User routes do *not* run framework middleware.
- The Vite plugins (`server-only`, `guard-strip`, `module-key-plugin`) target `.server.*` files and files importing `defineServerGuard`/`defineClientGuard`. They do not touch arbitrary user code.

The net effect: a Hono package added to `api.ts` behaves exactly as it would in a stock Hono project.

## 2. Hono built-in helpers and middleware

Status legend:
- **direct** — users (or the framework internally) import from `hono/*` with no wrapper.
- **wrap** — we re-export or thinly wrap a Hono primitive with framework-specific ergonomics.
- **replace** — we ship our own implementation of the same concept.
- **sidestep** — out of the framework's surface; users compose against their own `Hono` app exactly as in stock Hono.
- **unused** — not relevant to the framework or its target apps.

| Primitive | Where we touch it | Status | Decision | Rationale |
|---|---|---|---|---|
| `hono/cookie` | tests only; users call directly on `ctx.c` | direct | **keep** | API is already minimal. PR #41 typed `ctx.c` so `getSignedCookie(ctx.c, …)` works without casts. Wrapping would only re-export the same names. |
| `hono/jwt` + `hono/utils/jwt` | unused | sidestep | **keep** | Works today, identically to cookie auth. JWT-on-headers reaches loaders/guards/actions through the same PR #41 typed-`ctx.c` plumbing as cookies: `verify(c.req.header('Authorization').slice(7), secret)` inside a `defineServerGuard(...)`, or `app.use('/api/*', jwt({ secret }))` on `c.api`. The v0.1 reference *demo* uses signed cookies; that's a demo choice, not a support gap. |
| `hono/jsx` | unused | replace | **keep** | The whole point of hono-preact. `apps/app/vite.config.ts` sets `jsxImportSource: 'preact'`. |
| `hono/jsx-renderer` | unused | replace | **keep** | Same as `hono/jsx`. We render via `prerender()` from preact-iso, see `packages/server/src/render.tsx`. |
| `hono/streaming` (`streamSSE`) | `packages/server/src/sse.ts:2` | wrap | **keep wrapper** | `sseGeneratorResponse(c, gen)` and `sseReadableStreamResponse(c, source)` convert async generators / ReadableStreams into the SSE wire format with consistent JSON encoding and `event: error` frames on throw. `streamText`/`stream` are unwrapped; users call them directly if needed. |
| `hono/html` | unused | sidestep | **keep** | We have a full Preact pipeline; raw HTML template strings would compete with `prerender()`. Users wanting raw HTML responses can import `hono/html` for non-page Hono routes. |
| `hono/context-storage` | unused | **replace** | **keep our `runRequestScope`** | Hono's helper only stashes `c`; we need a per-request `Map<unknown, unknown>` for loader-cache memoization, and our store has to be isomorphic (server + browser via a same-shape no-op on the client). See `packages/iso/src/cache.ts:32-63`. Documented decision from PR #41 prework. |
| `hono/cors` | unused | sidestep | **keep, document** | Per-route CORS policy is opinionated; mounting it framework-wide would push a default users would have to undo. Worth a "recommended Hono middleware" docs page. |
| `hono/csrf` | unused | sidestep | **keep** | Users mount `csrf()` on their `c.api` like in any other Hono app. The framework deliberately doesn't pre-decide for them. A user who wants CSRF on `/__actions` specifically registers `app.use('/__actions', …)` in their `api.ts`: #43 mounts the user app ahead of the reserved paths, so that middleware reaches the endpoint. Framework auto-mounting would still violate "use Hono as normal." |
| `hono/secure-headers` | unused | sidestep | **keep, document** | Recommend in docs; default policy is user-specific. |
| `hono/cache` | unused | sidestep | **keep** | Page-level HTTP caching is a render-side concern that interacts badly with our streaming responses. Loader-side caching is already in-process via `runRequestScope`. |
| `hono/etag` | unused | sidestep | **keep** | SSR-streamed responses can't be ETag'd cleanly. Out of hot path. |
| `hono/logger` | unused | sidestep | **keep, document** | Users compose at their `Hono` app. Mention in deployment docs. |
| `hono/timing` | unused | sidestep | **keep, document** | Users mount `timing()` on their `Hono` app as in stock Hono. A future framework helper could expose `setMetric(c, 'loader', ms)` calls at the SSR seams as an opt-in, but the default is "use it as normal" with a docs recipe showing what marks to emit from inside loaders/actions. |
| `hono/request-id` | unused | sidestep | **keep** | Users compose. Could surface `c.get('requestId')` to loaders, but premature without a logging story. |
| `hono/factory` (`createMiddleware`) | `packages/server/src/middleware/location.ts:1` | direct (internal) | **keep** | Internal use to build the `location` middleware. No user-facing API. |
| `hono/accepts` | unused | sidestep | **keep** | Not on our surface. |
| `hono/adapter` | unused | sidestep | **keep** | Target is Cloudflare Workers (see `@hono/vite-build/cloudflare-workers`). Multi-runtime adapter selection deferred to post-v0.1. |
| `hono/conninfo` | unused | sidestep | **keep** | Users compose. |
| `hono/dev` | unused | sidestep | **keep** | Vite owns dev concerns. |
| `hono/proxy` | unused | sidestep | **keep** | Users compose. |
| `hono/route` (`basePath`) | unused | sidestep | **keep** | Users compose at their `Hono` app. |
| `hono/ssg` | unused | sidestep | **keep** | We're SSR + streaming-first. SSG not in v0.1 scope. |
| `hono/testing` | unused | sidestep | **keep** | Our tests instantiate `Hono` directly and call `app.request(...)`. |
| `hono/validator` | unused | sidestep | **keep** | Validation is action-side; users compose Zod / standard-schema as they see fit. |
| `hono/client` (RPC) | unused | sidestep | **keep, document** | Our typed loaders + actions are the framework's RPC surface. `hc<typeof routes>()` continues to work for user-defined `c.api` routes; the two coexist. Worth a one-paragraph mention in docs. |
| `hono/serve-static` | unused | sidestep | **keep** | Vite / Cloudflare Workers serve static assets. |
| `hono/basic-auth`, `hono/bearer-auth` | unused | sidestep | **keep** | Users compose in their `c.api` middleware chain. Our guards run *after* the Hono request lifecycle and target page-level access. |
| `hono/body-limit`, `hono/ip-restriction`, `hono/compress`, `hono/method-override`, `hono/powered-by`, `hono/pretty-json`, `hono/language`, `hono/trailing-slash`, `hono/timeout`, `hono/combine`, `hono/jwk` | unused | sidestep | **keep** | All user-composable. None warrants framework opinion. |
| `hono/tiny`, `hono/quick` (presets) | unused | sidestep | **keep** | We use stock `hono` (RegExp router default). Preset choice is a user-deployment concern. |
| `hono` adapters (`hono/bun`, `hono/deno`, `hono/cloudflare-workers`, `hono/cloudflare-pages`, `hono/aws-lambda`, `hono/vercel`, etc.) | unused directly | sidestep | **keep** | Deploy target is set by `@hono/vite-build/*`. Multi-target story is a post-v0.1 conversation. |
| `hono/utils/http-status` | `packages/iso/src/action.ts:3`, re-exported from `packages/iso/src/index.ts:37` | direct + re-export | **keep** | `ContentfulStatusCode` narrows `ActionGuardError.status` (PR #39). Re-exporting the type keeps user code free of a Hono internal-path import. |

---

## 3. `@hono/*` ecosystem packages

Pulled the current list from npm (`registry.npmjs.org/-/v1/search?text=@hono`, 36 packages as of 2026-05-14).

| Package | Where we touch it | Status | Decision | Rationale |
|---|---|---|---|---|
| `@hono/vite-build` | `packages/vite/src/hono-preact.ts:1` (`/cloudflare-workers` entry) | direct | **keep** | Production build adapter. Known entry-resolution gotcha already recorded in `reference_hono_vite_build_entry.md` memory. |
| `@hono/vite-dev-server` | `packages/vite/src/hono-preact.ts:2-3` (with Cloudflare adapter) | direct | **keep** | Dev server + worker runtime emulation. |
| `@hono/node-server` | `apps/app/package.json` devDep; transitive via `@hono/vite-dev-server` | transitive | **keep** | Required for `@hono/vite-dev-server`. Not in any published `hono-preact` package. |
| `@hono/vite-cloudflare-pages` | unused | sidestep | **keep** | We target Workers, not Pages. Optional adapter post-v0.1. |
| `@hono/vite-ssg`, `@hono/ssg-plugins-essential` | unused | sidestep | **keep** | No SSG in v0.1. |
| `@hono/zod-validator`, `@hono/standard-validator`, `@hono/typebox-validator` | unused | sidestep | **keep** | Validators belong inside user-authored actions/loaders. Framework stays validator-agnostic. |
| `@hono/zod-openapi`, `@hono/swagger-ui` | unused | sidestep | **keep** | Schema/docs generation is a user concern on their `c.api`. |
| `@hono/auth-js`, `@hono/clerk-auth`, `@hono/firebase-auth`, `@hono/oauth-providers`, `@hono/oidc-auth`, `@hono/session`, `@hono/stytch-auth`, `@hono/cloudflare-access` | unused | sidestep | **keep** | All work today via typed `ctx.c` inside `defineServerGuard()`. Worth a docs recipe for one of these post-v0.1 (Clerk is the obvious candidate). |
| `@hono/sentry`, `@hono/otel`, `@hono/prometheus`, `@hono/structured-logger` | unused | sidestep | **keep, document** | Observability is user-composable. Recommend in deployment docs alongside `hono/logger`. |
| `@hono/trpc-server` | unused | sidestep | **keep** | Coexists with our RPC. Not a competitor. |
| `@hono/event-emitter` | unused | sidestep | **keep** | User-composable. |
| `@hono/mcp` | unused | sidestep | **keep** | User-composable. |
| `@hono/inertia` | unused | compete | **n/a** | Different rendering strategy (Inertia island-protocol vs our streaming SSR). Not relevant. |
| `@hono/react-renderer`, `@hono/react-compat` | unused | compete | **n/a** | We are the Preact equivalent. Not relevant. |
| `@hono/node-ws`, `@hono/capnweb` | unused | sidestep | **keep** | Realtime / RPC transports user composes. |
| `@hono/casbin` | unused | sidestep | **keep** | Authorization policy lives in guards. |
| `@hono/cli` | unused | sidestep | **keep** | Not relevant to a meta-framework consumer's workflow. |
| `@hono/ua-blocker` | unused | sidestep | **keep** | User-composable middleware. |

---

## 4. Why no "replace" rows

Going in I expected at least one row where we'd done extra work that Hono's helper already covers. The closest is `hono/context-storage`, which I deliberately *don't* count as a replace candidate: it solves a strictly narrower problem (stash `c`) than what `runRequestScope` does (per-request `Map` for loader-cache memoization, isomorphic between server and browser), and Hono's helper has no client-side equivalent.

The framework's surface is small and deliberately leaves the rest of Hono undisturbed. User code runs against the same `Hono` instance and the same `Context` they'd use without us. That permissiveness is the feature, not an accident.

---

## 5. What the framework actually reserves

To use Hono packages "as normal," users need to know what *isn't* fair game. The constraints are short:

- **Two reserved paths:** `POST /__loaders` and `POST /__actions`. Anything else is the user's.
- **The wildcard `GET *` handler** at the end of the entry catches unmatched requests for SSR. Catch-all routes in `api.ts` get a build-time warning so users don't shadow themselves. Mount specific routes; the framework will not match them.
- **`.server.*` filename convention** for files the server-loaders / module-key plugins transform. Other user files are untouched.
- **`defineServerGuard` / `defineClientGuard`** imports trigger the `guard-strip` plugin, which rewrites opposite-env factory calls to no-ops. Doesn't affect non-importing files.

Anything outside those four points is, by design, exactly like writing a stock Hono app.

---

## 6. Worked example: WebSockets

To make the guiding principle concrete, here's the WebSocket case the framing question raised. No framework code change required.

In `apps/app/src/api.ts`:

```ts
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/cloudflare-workers';

export default new Hono()
  .get(
    '/ws',
    upgradeWebSocket((c) => ({
      onOpen(_, ws) { ws.send('hello'); },
      onMessage(event, ws) { ws.send(`echo: ${event.data}`); },
      onClose() { /* ... */ },
    }))
  );
```

The generated server entry mounts this via `.route('/', userApp)` before the wildcard `renderPage`. A `GET /ws` request matches user code, never reaches the SSR catch-all, and the `Upgrade: websocket` header is honored by the Cloudflare Workers runtime per Hono's standard adapter contract. Same code, same Hono package, same result as a non-framework Hono app.

**Known dev-server gap:** `@hono/vite-dev-server` does not currently forward WebSocket upgrade requests. To exercise the route locally before deploying, use `wrangler dev` against the build output, or stand up a parallel `@hono/node-server` dev process. Production (Workers, Bun, Deno, Node via `@hono/node-server`) is unaffected. This is an ecosystem gap, not a framework constraint, and is the right shape for a docs note rather than a framework intervention.

---

## 7. Recommendations

None of these block v0.1; all are docs / examples that reinforce the "use Hono as normal" contract.

1. **Docs page: *Composing Hono middleware*** — one page under the **Infrastructure** nav section showing the user-app mount point (`api.ts`), the four reserved surfaces from section 5, a short recipe per primitive worth a default mention (`hono/cors`, `hono/csrf`, `hono/secure-headers`, `hono/logger`, `hono/timing`, `@hono/sentry`, `@hono/otel`), and a worked `csrf()`-on-`c.api` example for `<Form>` posts when an app's origin policy needs it.
2. **Docs page: *WebSockets and long-lived connections*** — the worked example from section 6, plus the dev-server gap and the recommended local workflow.

Two non-recommendations explicitly recorded:

- **Do not auto-mount `hono/csrf` on `/__actions`.** Earlier draft proposed this; it violates the guiding principle. Resolved by #43 (`docs/superpowers/specs/2026-05-17-reserved-path-middleware-design.md`): the user app now mounts ahead of the reserved paths, so users compose `csrf()` themselves with no framework auto-mount.
- **Do not ship a framework `serverTiming()` helper that auto-mounts `hono/timing`.** If we later expose timing marks at SSR seams, expose them as opt-in primitives users wire into their own `hono/timing` middleware, not as a framework-managed default.

---

## 8. Tracked follow-ups

Issues spawned from this audit:

- **#42** — Borrow from `hono/client`: `stub.url()` / `stub.path()` accessors, `$ws()` precedent for realtime, explicit docs endorsement of `hc<typeof userApp>()` for non-page RPC.
- **#43** — CSRF middleware reach into framework-reserved paths (`/__actions`, `/__loaders`). Bring-your-own-entry vs middleware-slot design space.
- **#44** — Middleware system for loaders and actions (RPC layer). Hono-shape vs decorator vs per-route binding.
- **#45** — Post-v0.1 tracker indexing the above plus the two docs pages from section 7.

The v0.1 launch issue (#37) carries one small docs note: the SameSite-cookies posture for `/__actions`, since #43's full design is post-v0.1.
