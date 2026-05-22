# Middleware system for loaders, actions, and pages (unified RPC + render layer)

**Date:** 2026-05-20
**Status:** design spec, ship target post-v0.1
**Issue:** [#44](https://github.com/sbesh91/hono-preact/issues/44)
**Predecessors:** PR #39 (single guards list), `docs/superpowers/research/2026-05-14-hono-primitives-audit.md`

---

## TL;DR

Ship one middleware primitive that unifies the framework's three current "things that wrap a call" concepts (page guards, action guards, and the new RPC-layer hooks asked for in #44) into a single `defineServerMiddleware` / `defineClientMiddleware` pair, with a companion `defineStreamObserver` primitive for per-chunk events. Both kinds register through a single `use` array at three binding layers (root via `defineApp`, page via `definePage`, per-unit via `defineLoader` / `defineAction`). Outcomes (`redirect`, `deny`, `render`) cross SSR-inline, RPC, and client navigation transports through one runner. Today's `defineServerGuard`, `defineClientGuard`, `defineActionGuard`, and related types are removed wholesale; this design replaces them, not augments them.

The system is observe-and-gate (Option A in the issue's framing), explicitly *not* a transform middleware (Option B). The reasons against transform are detailed in section "Why observe-and-gate."

## Decision

**Ship.** Implementation plan follows from this spec; tracked separately. No deferral, no minimal-now-upgrade-later split. The framework gets one well-formed middleware story.

## Motivation

Today the framework has three overlapping concepts that all answer slight variations of "wrap a call with policy":

- **Page guards** (`GuardFn[]` on `definePage`): route-bound, run server *and* client, return `redirect` / `render` / void.
- **Action guards** (`actionGuards` module export): `(ctx, next)` chain, server-only, RPC-layer, block by throwing `ActionGuardError`.
- **The gap #44 names**: per-loader / per-action middleware for timing, logging, fine-grained perms, tracing, with `(ctx, next)` semantics.

These are not three different problems. They're three expressions of one problem ("compose policy and observability around a request-scoped call") that the framework hasn't yet unified. Adding a third concept as #44 originally proposed would lock in the fragmentation. This design folds all three into one primitive.

## Why observe-and-gate (the A vs B decision)

A transform middleware ("`const data = await next(); return redact(data)`") was considered and rejected. Reasons:

1. **Streaming.** Loaders and actions return three shapes (`Promise<T>`, `Promise<ReadableStream<T>>`, `AsyncGenerator<T>`). A transform middleware that receives a live stream either buffers (killing TTFB) or hand-writes a TransformStream wrapper (per-chunk surgery, must correctly forward error frames, the action `result` SSE event, backpressure, abort). That's expert-level code in what should be a five-line `withLogging`.
2. **Typing erases.** Transform middleware is generic in the result type, but the layered binding model puts middleware at root and page layers wrapping many loaders with different `T`s. Root-layer transform can only be typed `<T>(data: T) => T`, which can't meaningfully transform. The power evaporates exactly where the architecture can express it.
3. **Ordering becomes silently load-bearing.** `[redact, envelope]` vs `[envelope, redact]` produce different payloads with no type-level signal.
4. **Erodes the sanitization boundary.** `loaders-handler.ts` deliberately never leaks loader error messages in prod. Transform middleware that converts errors into data would straddle that boundary.
5. **Cache identity ambiguity.** Transform middleware rewriting the result raises "does the cache hold raw or transformed?" against `useData()` and optimistic snapshots. Observe-and-gate never raises the question.

The legitimate use cases for transform middleware (uniform envelope wrapping, policy redaction, locale normalization) are uniform transforms that don't want the loader's `T`. They are better served by a future framework-level serialization hook than by general middleware.

`next()` returns `Promise<unknown>` (intentionally weak). Middleware can read the value for logging / metrics / tracing but cannot meaningfully transform it; the middleware's own return type is `Promise<Outcome | void>`, so `return await next()` is a type error.

## Primitives

Three primitives total. Each lives in its own file under `@hono-preact/iso`.

### `defineServerMiddleware`

```ts
type ServerBaseCtx = { c: Context; signal: AbortSignal };

type ServerPageCtx   = ServerBaseCtx & { scope: 'page';   location: RouteHook };
type ServerLoaderCtx = ServerBaseCtx & { scope: 'loader'; location: RouteHook;
                                          module: string; loader: string };
type ServerActionCtx = ServerBaseCtx & { scope: 'action'; module: string;
                                          action: string; payload: unknown };

type ServerCtx<S extends Scope = Scope> =
  S extends 'page'   ? ServerPageCtx :
  S extends 'loader' ? ServerLoaderCtx :
  S extends 'action' ? ServerActionCtx :
  ServerPageCtx | ServerLoaderCtx | ServerActionCtx;

type Scope = 'page' | 'loader' | 'action';

type Next = () => Promise<unknown>;

type ServerMiddleware<S extends Scope = Scope> = {
  __kind: 'middleware';
  runs: 'server';
  fn: (ctx: ServerCtx<S>, next: Next) => Promise<void>;
};

export function defineServerMiddleware<S extends Scope = Scope>(
  fn: ServerMiddleware<S>['fn']
): ServerMiddleware<S>;
```

`signal` is present on all three server ctx variants (including page) because the page-render path is a request with a signal. Today's `ServerGuardContext` omits it; that's a v0.1 oversight, not a deliberate distinction.

### `defineClientMiddleware`

```ts
type ClientPageCtx = { scope: 'page'; location: RouteHook };

type ClientMiddleware = {
  __kind: 'middleware';
  runs: 'client';
  fn: (ctx: ClientPageCtx, next: Next) => Promise<void>;
};

export function defineClientMiddleware(
  fn: ClientMiddleware['fn']
): ClientMiddleware;
```

Implicitly page-scope only. There is no `ClientLoaderCtx` or `ClientActionCtx`: loaders and actions execute server-side regardless of where the navigation originated. The asymmetry with `defineServerMiddleware<S>` is deliberate; the contexts are structurally different (`c` exists on one and not the other), and parameterizing them through one factory would erase that difference.

### `defineStreamObserver`

```ts
type ServerStreamCtx = ServerLoaderCtx | ServerActionCtx;

type StreamObserver<TChunk = unknown, TResult = void> = {
  __kind: 'observer';
  onStart?: (ctx: ServerStreamCtx)                                            => void;
  onChunk?: (ctx: ServerStreamCtx, chunk: TChunk, index: number)              => void;
  onEnd?:   (ctx: ServerStreamCtx, info: { chunks: number; result: TResult }) => void;
  onError?: (ctx: ServerStreamCtx, err: unknown, info: { chunks: number })    => void;
  onAbort?: (ctx: ServerStreamCtx, info: { chunks: number })                  => void;
};

export function defineStreamObserver<TChunk = unknown, TResult = void>(
  spec: Omit<StreamObserver<TChunk, TResult>, '__kind'>
): StreamObserver<TChunk, TResult>;
```

Five lifecycle events. The three terminal events (`onEnd`, `onError`, `onAbort`) are mutually exclusive; exactly one fires per stream lifetime.

Why a separate primitive instead of folding stream observation into middleware: the two have genuinely different lifecycles (wrap-a-call vs per-chunk event-driven). The `(ctx, next)` shape is right for wrapping; it's wrong for per-chunk. Cramming both into one primitive taxes every middleware author with streaming concerns they don't need, and conflates failure modes (chain-breaking vs isolated). Two small sharp tools beats one fat one. This is the same reasoning as the A-not-B decision applied at the primitive level.

### Identity-free principle

Middleware and stream observers are identity-free at the type level. The dispatcher locates them by *where they are registered*, not by what they are. The same middleware value can be registered at multiple sites without identity confusion.

## Outcomes

The cross-primitive language for control flow.

### Three outcomes

```ts
type Outcome = RedirectOutcome | DenyOutcome | RenderOutcome;

type RedirectOutcome = {
  __outcome: 'redirect';
  to: string;
  status?: RedirectStatusCode;     // 301 | 302 | 303 | 307 | 308; default 302
  headers?: Record<string, string>;
};

type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;          // 4xx | 5xx
  message?: string;
  headers?: Record<string, string>;
};

type RenderOutcome = {
  __outcome: 'render';
  Component: FunctionComponent;
};
```

Status types are re-exported from `@hono-preact/iso` (`RedirectStatusCode`, `ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode`), matching the existing pattern that re-exports `ContentfulStatusCode`. Users never reach into `hono/utils/http-status` directly.

`Record<string, string>` is the right level of strictness for `headers`; Hono's typed header names add friction for custom headers without proportional value.

### One API: throw

```ts
import { redirect, deny } from '@hono-preact/iso';
import { render } from '@hono-preact/iso/page';   // subpath, page-scope only

throw redirect('/login');
throw deny(403, 'Forbidden');
throw render(LoginPage);

// Object form for headers / non-default codes:
throw redirect({ to: '/login', status: 307, headers: { 'X-Reason': 'auth' } });
throw deny({ status: 429, message: 'Slow down', headers: { 'Retry-After': '5' } });
```

Helpers construct outcomes; the author throws. No return form.

Rationale for throw-only:
- It works from arbitrary call depth in loader / action bodies (no threading of outcome values up through helper frames).
- It works in async generators (streaming loaders / actions), where return values are reserved for chunks.
- It composes uniformly via `try` / `catch`, so the dispatcher and user middleware speak the same language.
- One way to do it.

### `render` scope enforcement

`render` is page-scope only and lives at a subpath: `@hono-preact/iso/page`. Loader and action middleware files should not import from this subpath. Enforcement is layered:

- **Code review and convention** (primary): the subpath import is visible at review.
- **Optional eslint rule** (recommended in the new docs page): `no-restricted-imports` to ban `@hono-preact/iso/page` from `.server.ts` files.
- **Dev-mode runtime check** (defense in depth): the dispatcher detects a `render` outcome thrown from non-page scope and surfaces a clear error.

A fully static enforcement would require either a token argument to `render` (noisy at every call site) or module augmentation tricks (fragile). The runtime + lint + convention triple is the better DX trade.

### How each outcome lands

| Outcome     | SSR-inline (page render) | Loader RPC                                      | Action RPC                                      | Client navigation |
|-------------|--------------------------|--------------------------------------------------|--------------------------------------------------|--------------------|
| **redirect** | HTTP redirect response with `status` and `headers`. | In-band JSON envelope `{ __outcome: 'redirect', to, status, headers }` on a 200; client stub assigns `window.location`. | Same envelope. `mutate()`'s promise enters a never-settling state; browser navigates. | preact-iso router navigates to `to`. |
| **deny**     | Error response with `status` and `headers`; body rendered via the page's `errorFallback`. | `c.json({ __outcome: 'deny', message }, status)` with `headers` applied. | Same. | Client middleware surfaces via the page's `errorFallback`. |
| **render**   | `renderPage` mounts `Component` instead of the matched page. | Compile-time error at the subpath; dev-mode runtime error if reached. | Same. | preact-iso mounts `Component` for this navigation (same URL, no history entry). |

The wire envelope uses a `__outcome` discriminator field rather than today's `__redirect` shape; future outcomes can share the envelope without inventing new protocols.

In-band JSON envelope (not HTTP 302) for RPC redirects, because the browser is doing `fetch`, not a navigation; a 302 would be followed by `fetch` and yield the target page's HTML, not the navigation we want.

### Composition

Outer middleware can re-emit an inner outcome by catching and re-throwing:

```ts
const friendlyDeny = defineServerMiddleware<'page'>(async (ctx, next) => {
  try {
    await next();
  } catch (e) {
    if (isDeny(e)) throw render(ForbiddenPage(e.status, e.message));
    throw e;
  }
});
```

Outer can re-emit *control flow*, but cannot rewrite the result *data* of the inner call. Outcomes are control flow; transforming control flow is fine. The data payload remains untouched.

### Plain errors

`throw new Error(...)` is *not* an outcome. The dispatcher passes it through to the handler's sanitization layer (which controls prod-vs-dev message visibility). Middleware can convert an error into a structured response explicitly:

```ts
try { await next(); } catch (e) {
  if (isOutcome(e)) throw e;
  log.error(e);
  throw deny(500, 'Service unavailable');
}
```

### Dispatcher invariants

- **Forgotten `next()`** is a loud error. A middleware must either await `next()` or short-circuit via a thrown outcome. Silent fall-through is rejected.
- **Outcome scope mismatch.** A `render` thrown from non-page scope is a runtime error in dev.
- **Multiple outcomes thrown sequentially** during catch handling: the most recently thrown wins (`try`/`catch` semantics).

## Layered binding

Three binding layers, outer→inner, with deterministic ordering.

### Where you attach: one unified field

```ts
defineApp({
  use: [
    withRequestId,           // ServerMiddleware
    withSentry,              // ServerMiddleware
    streamAuditObserver,     // StreamObserver
  ],
});

definePage(Component, {
  use: [
    requireAuth,             // ServerMiddleware (page scope)
    requireAuthClient,       // ClientMiddleware
    perPageTracing,          // StreamObserver
  ],
});

defineLoader<Movie[]>(streamingMovies, {
  use: [
    withMovieCacheStamp,     // ServerMiddleware (loader scope)
    withMovieChunkMetrics,   // StreamObserver
  ],
});

defineAction<Payload, Result, Chunk>(streamingAction, {
  use: [
    withIdempotency,         // ServerMiddleware (action scope)
    withRateLimit,
  ],
});
```

One field per binding site, accepting both middleware and stream observers. The dispatcher partitions internally via the entry's `__kind` brand.

Naming: `use` mirrors Hono's `app.use(...)` verb. Keeping the primitive names (`defineServerMiddleware`, `defineStreamObserver`) precise means the field name doesn't have to also discriminate.

### Composition semantics

For a given loader or action invocation, the effective chain is **root + page (for the matched route) + per-unit**, in that order outer-to-inner. For a page render, the chain is **root + page** with no per-unit.

```
[root: requestId] → [root: sentry] → [root: timing]
  → [page: requireAuth] → [page: roleCheck]
    → [unit: cacheStamp]
      → loader / action body
```

### Ordering rules

- **Within a layer**, order is the array order at the binding site. No priority numbers, no implicit reordering.
- **Between layers**, root runs before page runs before per-unit.
- **No re-entry, no skipping.** A middleware that doesn't call `next()` short-circuits everything downstream of it. Forgotten-`next()` is detected by the runner.

### Type-level binding gates

The `use` array element type is layered. One generic, four narrowings:

```ts
type Use<S extends Scope, Streaming extends boolean, T = unknown, R = void> = ReadonlyArray<
  | ServerMiddleware<S>
  | (S extends 'page' ? ClientMiddleware : never)
  | (Streaming extends true ? StreamObserver<T, R> : never)
>;

type AppUse    = Use<Scope, true>;
type PageUse   = Use<Scope, true>;
type LoaderUse<T, Streaming extends boolean>          = Use<'loader', Streaming, T, void>;
type ActionUse<TChunk, TResult, Streaming extends boolean> = Use<'action', Streaming, TChunk, TResult>;
```

Overload-gating on `defineLoader` / `defineAction` enforces "stream observers only on streaming loaders / actions":

```ts
function defineLoader<T>(
  fn: NonStreamingLoader<T>,
  opts?: DefineLoaderOpts<T> & { use?: LoaderUse<T, false> }
): LoaderRef<T>;

function defineLoader<T>(
  fn: StreamingLoader<T>,
  opts?: DefineLoaderOpts<T> & { use?: LoaderUse<T, true> }
): LoaderRef<T>;
```

The non-streaming overload's `LoaderUse<T, false>` excludes `StreamObserver` from the element type, so a stream observer at that call site fails to assign. Error messages can be sharpened with a branded helper type that carries the explanation as the type itself; the implementation plan refines exact wording.

A stream observer in a non-streaming loader's `use` array is a compile error.

**Sharp edge:** if a loader's return type is `Promise<T | ReadableStream<U>>` (unusual), overload resolution picks the non-streaming branch and rejects stream observers. The author has to narrow at the call site or split into two loaders. That's probably the right outcome anyway; mixed-shape loaders are a smell.

**Page-layer stream observers** are always accepted (the page can't statically know whether a dispatched loader will stream). Observers attached at the page layer simply don't fire when the dispatched loader isn't streaming. Documented explicitly so authors don't think a quiet page-layer audit hook is broken.

**Defense in depth at runtime**: the runner also asserts at registration. A stream observer applied to a non-streaming binding is a hard error in prod (after build-time stripping or `any` laundering somehow bypasses the type check).

## Server vs client execution

### Two helpers, distinct types

`defineServerMiddleware<S extends Scope>` and `defineClientMiddleware` are separate factories. Their contexts differ structurally; a single parameterized factory would erase the structural difference.

### Where each kind can be bound

|                                          | root (`defineApp`)    | page (`definePage`)    | per-unit (`defineLoader` / `defineAction`) |
|------------------------------------------|------------------------|-------------------------|---------------------------------------------|
| `ServerMiddleware<'page'>`               | accepted (page-scope) | accepted               | rejected (type error)                     |
| `ServerMiddleware<'loader' \| 'action'>` | accepted               | accepted               | accepted                                    |
| `ServerMiddleware<Scope>` (default any)  | accepted               | accepted               | accepted                                    |
| `ClientMiddleware`                       | accepted (page-scope) | accepted               | rejected (type error)                     |
| `StreamObserver`                         | accepted               | accepted               | accepted (streaming only, overload-gated)   |

### Execution

- **Server page middleware** runs during SSR (inside `renderPage`) and during a hard navigation on the server. Not re-run during preact-iso client navigation; no server roundtrip happens.
- **Client page middleware** runs during preact-iso client navigation. Tree-shaken from the server bundle by the guard-strip plugin's expanded allowlist.
- **Server loader / action middleware** runs once per dispatch, regardless of whether the dispatch is SSR-inline (`loader-runner.ts` direct-fn path) or RPC. Symmetry across the two paths is non-negotiable.

### Page-layer chain: server + client compose

A page's `use: [...]` list is a *mixed* list of server and client middleware in author-chosen order. The framework runs:

- **Server pass** (SSR or hard nav): filter the list to entries whose `runs === 'server'`, run in original order.
- **Client pass** (client navigation): filter to `runs === 'client'`, run in original order.

Inserting a server entry between two client entries does not affect the client pass's relative order.

### Documented patterns

- *"What if the same logical check needs both server and client expression?"* Author writes two middleware, gives them a shared helper module, and registers both in the list.
- *"Why isn't there a `runs: 'both'`?"* The two ctx types differ structurally (`c` exists on one and not the other); the only honest way to write one function that handles both is to branch on `'c' in ctx`, which is uglier than two named functions.

### Build-time tree-shake

The existing `guard-strip.ts` Vite plugin extends to:

- In **client bundles**: rewrite `defineServerMiddleware(...)` and `defineStreamObserver(...)` calls to no-op brand objects. Server-only bodies (and their server-only imports) get dead-code-eliminated.
- In **server bundles**: rewrite `defineClientMiddleware(...)` calls to no-op brand objects.

Same plugin pattern as today's guard-strip; the work is extending the symbol allowlist plus adjusting the rewrite shape.

## Stream observer

Lifecycle events and operational meanings repeated here for completeness.

- **`onStart`**: fired once before the first chunk leaves the body. Hook for opening spans, starting timers.
- **`onChunk(ctx, chunk, index)`**: fired once per emitted chunk, with monotonic `index`.
- **`onEnd(ctx, { chunks, result })`**: stream completed normally. `info.result` carries the action's `TResult` (typed for per-unit action observers; `void` for loaders; `unknown` for root/page-bound observers).
- **`onError(ctx, err, { chunks })`**: stream terminated due to an exception. `onEnd` does NOT fire when `onError` does.
- **`onAbort(ctx, { chunks })`**: signal aborted mid-stream (client disconnect). Distinct from `onError` because client disconnects are operational reality, not anomalies.

The three terminal events are mutually exclusive. Exactly one fires per stream lifetime.

### Failure isolation (non-negotiable contract)

Observers run in a sandbox. If an observer method throws, the framework catches it, surfaces via the same `onError` hook the loader / action handlers use for unrelated server errors, and *swallows it*. The stream emits the next chunk regardless.

This makes observers strictly safe to add. A buggy observer cannot corrupt the channel it observes.

### Synchronous semantics

Observer methods are `=> void`. The framework does not await them between chunks. An observer can do async work internally, but the stream's chunk rate is independent of observer durations. Adding an observer never changes wire timing.

Backpressure shaping is a different concern. Out of scope for v1; if a need surfaces, it gets a separate `tap` or `gate` primitive with explicit await semantics.

### What observers cannot do

- Transform chunks.
- Inject chunks.
- Terminate the stream.
- Block the stream.

These constraints are why observers are safe-by-construction. The body owns the stream.

## Public API surface

All from `@hono-preact/iso` unless noted.

```ts
// Middleware primitives
export function defineServerMiddleware<S extends Scope = Scope>(fn): ServerMiddleware<S>;
export function defineClientMiddleware(fn): ClientMiddleware;

// Stream observer primitive
export function defineStreamObserver<TChunk = unknown, TResult = void>(spec): StreamObserver<TChunk, TResult>;

// App config root
export function defineApp(config: AppConfig): AppConfig;

// Outcome constructors
export function redirect(to: string): RedirectOutcome;
export function redirect(spec: { to: string; status?: RedirectStatusCode; headers?: Record<string, string> }): RedirectOutcome;
export function deny(status: ErrorStatusCode, message?: string): DenyOutcome;
export function deny(spec: { status: ErrorStatusCode; message?: string; headers?: Record<string, string> }): DenyOutcome;

// Outcome predicates
export function isOutcome(value: unknown): value is Outcome;
export function isRedirect(value: unknown): value is RedirectOutcome;
export function isDeny(value: unknown): value is DenyOutcome;
export function isRender(value: unknown): value is RenderOutcome;

// Status types
export type { RedirectStatusCode, ErrorStatusCode, ContentfulStatusCode };

// Context types
export type { ServerBaseCtx, ServerPageCtx, ServerLoaderCtx, ServerActionCtx };
export type { ClientPageCtx };
export type { ServerStreamCtx };
export type { Scope };

// Primitive types
export type { ServerMiddleware, ClientMiddleware, StreamObserver, Outcome, AppConfig };
```

Page-scope-only outcome at a subpath:

```ts
// @hono-preact/iso/page
export function render(Component: FunctionComponent): RenderOutcome;
```

### `defineApp` shape

```ts
export type AppConfig = {
  use?: (ServerMiddleware<Scope> | ClientMiddleware | StreamObserver)[];
  // Other root config consolidates here over time; out of scope for this spec.
};
```

`defineApp` is the new app-level config root. User code instantiates it once (e.g., `apps/app/src/app-config.ts`); the framework-generated server entry and client entry import it and thread root middleware into the handlers and the client navigation.

### File layout

New files in `@hono-preact/iso`:

```
packages/iso/src/
  define-middleware.ts        defineServerMiddleware, defineClientMiddleware, types
  define-stream-observer.ts   defineStreamObserver
  define-app.ts               defineApp, AppConfig
  outcomes.ts                 redirect, deny, predicates, Outcome types
  page-only.ts                subpath barrel (exposed as @hono-preact/iso/page) exporting render() and any other page-scope-only API
  internal/
    middleware-runner.ts      dispatches the chain, translates outcomes (shape, not transport)
    stream-observer-runner.ts fans out lifecycle events
    use-partitioner.ts        splits use[] into middleware + observers
    page-middleware-host.tsx  replaces Guards; mounts client-side dispatch around the page
```

### Modified files

- `packages/iso/src/define-loader.ts`: `DefineLoaderOpts` gains `use` (overload-gated). Loader execution path consults the middleware-runner for the unit-layer chain.
- `packages/iso/src/action.ts`: `defineAction` gains `use`. Removes `defineActionGuard`, `ActionGuardError`, `ActionGuardFn`, `ActionGuardContext`.
- `packages/iso/src/define-page.tsx` + `page.tsx`: `guards` field becomes `use`; mixed server/client list. `Guards` host component replaced by `PageMiddlewareHost`.
- `packages/iso/src/guard.ts`: deleted entirely.
- `packages/server/src/loaders-handler.ts`: gains `appConfig` and route-table options, calls dispatcher, translates outcomes to HTTP / SSE.
- `packages/server/src/actions-handler.ts`: same.
- `packages/server/src/render.tsx`: dispatches root + page middleware for the page-render path.
- `packages/vite/src/guard-strip.ts`: extended allowlist (new middleware / observer helpers, opposite-env stripping).
- `packages/vite/src/server-loaders-parser.ts`, `module-key-plugin.ts`: extended to surface `pageUse`, `loaderUse`, `actionUse` exports into the emitted module shape.

## Runtime wiring

### Per-request lifecycle

**Loader RPC (`POST /__loaders`)**:

1. Validate body; resolve `module::loader` → `LoaderRef`.
2. Match `location.path` against the route table → page module.
3. Build chain: `[...appConfig.use, ...pageModule.use, ...loaderRef.use]`.
4. Partition: middleware → chain, observers → fanout.
5. Dispatch: middleware chain wraps the loader body; if the body emits a stream, the stream-observer-runner fires lifecycle events into the observer fanout.
6. Translate result: thrown outcome → transport response; plain return → JSON or SSE.

**Action RPC (`POST /__actions`)**: same shape; action's owning page is unambiguous from the module key (the `.server.ts` file colocates with one page in the route table).

**SSR-inline loader**: `runLoader` in `loader-runner.ts`'s direct-fn path calls into the same middleware-runner. The chain is composed identically; the only difference from RPC is that the dispatcher's "transport translation" step on outcome / result hands back to the calling SSR machinery instead of writing an HTTP response.

**Page render (server)**: `renderPage` runs the root + page chain (scope `'page'`) before mounting `<Component/>`. Outcomes translate to HTTP redirect / error response / alternative component mount.

**Client navigation**: `PageMiddlewareHost` wraps the page during preact-iso navigation. It imports the runner, the route-aware page chain, and the client-side root chain (from `defineApp`'s client export). Runs the `runs === 'client'` filter. Outcomes translate to preact-iso navigate / errorFallback / alternative component mount.

### Discovery mechanics

`definePage(Component, bindings)` attaches `bindings.use` to the returned function as a non-enumerable property. The Vite server-loaders-parser also emits a sibling `pageUse` export per module, picked up by the server-modules glob. Either path gives the dispatcher a lookup from module key → page-layer `use`.

The route table (`define-routes.tsx`) gains two methods used by the dispatcher:

```ts
routeTable.matchPage(path: string): PageModule | undefined;
routeTable.pageModuleFor(moduleKey: string): PageModule | undefined;
```

### Caching

The chain composition runs per request. Chain length is small (typically under 10 entries); module lookups are O(1). No caching in v1. If profiling later flags it, key by `(moduleKey, pageKey)`; entries are immutable post-boot.

### Tree-shake integration

`guard-strip.ts`'s allowlist extends to recognize the new helpers and rewrites opposite-env calls to no-op brand objects in the wrong-env bundle. Same plugin pattern as today.

### Observer dispatch

The middleware-runner doesn't know about observers. The dispatcher partitions via `use-partitioner.ts` before walking the chain. If the inner function returns or yields a stream, the runner wraps the stream-handle in a stream-observer-runner that fires `onStart` / `onChunk` / etc. into every observer in the partition list. Ordering within each lifecycle event is `[...root, ...page, ...unit]`. Within-layer ordering is array order.

### Error sanitization stays at the handlers

The middleware-runner does not sanitize plain errors. A non-Outcome throw flows up to the handler, which continues to control prod-vs-dev message visibility. The runner does not pull that responsibility into itself.

## Removed legacy concepts

Back-compat is not a constraint. The design replaces these wholesale; the implementation pass is a one-shot demolition.

**Deleted from `@hono-preact/iso`:**

- `defineServerGuard`, `defineClientGuard`, `runServerGuards`, `runClientGuards`
- `GuardRedirect`, `GuardResult`, `GuardFn`, `ServerGuardFn`, `ClientGuardFn`
- `ServerGuardContext`, `ClientGuardContext`, `GuardRunsOn`
- `defineActionGuard`, `ActionGuardError`, `ActionGuardFn`, `ActionGuardContext`
- The `packages/iso/src/guard.ts` file in its entirety

**Removed from page bindings:**

- `definePage`'s `guards: GuardFn[]` field. Replaced by `use`.
- The `Guards` host component (replaced by `PageMiddlewareHost`; no alias kept).

**Removed from action modules:**

- The `actionGuards: ActionGuardFn[]` module export pattern.
- The `actions-handler.ts` code path that reads `mod.actionGuards`.
- The `runActionGuards` function (its loud-error-on-forgotten-`next()` behavior is preserved in the new dispatcher).

**Vite plugin:**

- `guard-strip.ts` stops recognizing the four guard helpers; it now recognizes the new middleware / observer helpers.

**Test fixtures:**

- `packages/iso/src/__tests__/guard*.test.*` rewritten as middleware tests against the new dispatcher.
- `apps/app` code that uses guards rewritten in-place. Single tree, no parallel implementation.

## Out of scope (deliberate deferrals)

- **Transform middleware (Option B).** Permanently out. Streaming, typing, ordering, sanitization, cache-identity arguments hold.
- **Client-side stream observers.** Streams flow server→client; client doesn't produce chunks the framework controls. No `defineClientStreamObserver`.
- **Awaited / backpressure-shaping observers.** Synchronous-only is the v1 contract. If real use cases appear, a separate `defineStreamTap` primitive.
- **Hono-style path matchers** (`use('/movies/*', mw)`). The layered model covers the same expressive range without splitting the source of truth.
- **Auto-instantiated middleware** (Sentry, OTel by config flag). Framework keeps the "compose Hono as normal" posture from the primitives audit. Recipes live in docs.
- **`runs: 'both'` middleware flavor.** Ctx types differ structurally; two named functions are cleaner than one branching function.
- **Outcome propagation between sibling streaming chunks.** Outcomes apply to whole calls, not partial streams. Mid-stream conditions are the body's responsibility (yield an error chunk, throw).
- **Reordering or priority numbers within a layer.** Array order is the order. No `priority: 10`.

## Docs impact

- `apps/site/src/pages/docs/guards.mdx`, `action-guards.mdx`: deleted; content folded into the new middleware page.
- New: `apps/site/src/pages/docs/middleware.mdx`. Covers the unified primitive, both flavors, outcomes, the `use` field, the three layers, and worked examples (auth, timing, tracing, per-chunk audit, page render-replacement).
- `apps/site/src/pages/docs/structure.mdx`: updated to show `defineApp` as the app config root.
- The "Composing Hono middleware" docs page (from the primitives audit recommendation): gets a paragraph clarifying that framework middleware composes inside the RPC layer; Hono middleware on `c.api` composes around it; the boundary is the reserved paths.

## Implementation order

Tracked in a separate implementation plan. High-level shape:

1. Land the primitive types and the outcome system (no dispatcher yet). Pure type work; unit-testable in isolation.
2. Build the middleware-runner and stream-observer-runner in `@hono-preact/iso/internal/`. Isomorphic; full unit coverage of the dispatcher invariants (forgotten-`next()`, outcome propagation, observer failure isolation, ordering).
3. Wire root + page + per-unit discovery in the handlers (`loaders-handler.ts`, `actions-handler.ts`, `render.tsx`). Integration tests against existing fixtures.
4. Extend the guard-strip plugin allowlist and the server-loaders parser to surface `use` exports.
5. Delete the legacy guard / actionGuard surface in one commit. Update all `apps/app` and `apps/site` code in the same commit.
6. Docs: delete the two old pages, write the new middleware page, update structure docs.

## Open questions

None requiring resolution before implementation. Items flagged as "out of scope" are explicit deferrals, not unresolved.
