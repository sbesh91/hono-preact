# Loader inversion: route-binding by composition, streaming unified into loaders

Date: 2026-06-29
Supersedes: the `defineStream` / `useEventStream` approach in PR #212 (#127)
Status: design approved, ready for implementation plan

## Problem

PR #212 (#127) added a separate `defineStream` / `useEventStream` primitive for
route-independent streaming. Review surfaced that it mints a parallel RPC shape
(`serverStreams`, `/__streams`, `streamsHandler`, a 5th codegen sibling) for what
is really "a loader without a route." The authoring surfaces of a streaming
`defineLoader` and `defineStream` are near-identical, and the server handler had
to fill a phantom empty `location` (the impedance mismatch made visible).

The framework's term for data fetching AND streaming is the **loader**. The goal
is three RPC shapes only: **loaders**, **sockets (and rooms)**, and **actions**.
Route-independent streaming should be a loader, expressed by **composition**, not
a config flag or a parallel primitive.

## The inversion

Route-binding becomes a composition, supplied by the existing `serverRoute`
machinery, and bare `defineLoader` becomes the route-independent primitive:

- **`serverRoute('/items/:id').loader(fn)`** — route-bound. Supplies typed
  `location.pathParams`/search, route-node `use` inheritance (the page tier), and
  SSR participation. The only way to get URL information.
- **`defineLoader(fn)`** — route-independent. ctx is `{ c, signal, call }` (no
  `location`), app-level `use` only, consumable anywhere including outside the
  router. A generator body gives the live-feed case. This subsumes `defineStream`.

So `defineStream` / `useEventStream` / `serverStreams` / `/__streams` all dissolve
back into the loader model. Auth becomes composition-evident: you used
`serverRoute` → you get route guards; you used bare `defineLoader` → you do not.

## Three orthogonal axes

The design separates three independent concerns that the old `live` flag and the
`defineStream` split had entangled:

1. **Route binding (composition).** `defineLoader(fn)` (route-independent) vs
   `serverRoute(r).loader(fn)` (route-bound). Controls `location` and the
   page-tier auth chain.
2. **Streaming (inferred from the body).** `(ctx) => AsyncGenerator<T>` is
   streaming (accumulating `.View`); `(ctx) => Promise<T>` is finite (single-value
   `.View`, SSR-eligible). No flag.
3. **SSR vs client-only for streams (config).** An explicit `{ live: boolean }`
   option on the loader. `live: false` (default) → the stream is pumped during
   SSR (the existing streaming-SSR path). `live: true` → client-only subscription
   (never run during SSR). Orthogonal to route binding.

`live` is the one deliberate config knob, scoped to exactly the SSR-vs-client
decision it is good at. Everything else is composition or inference. This is a
pragmatic, reversible choice (we already shipped `live: true`); the combinator
alternatives (`clientOnly(gen)`) were considered and set aside for simplicity.

### The streaming lifecycle matrix

| | route-independent (`defineLoader`) | route-bound (`serverRoute(r).loader`) |
| --- | --- | --- |
| **finite** (`=> Promise<T>`) | SSR (suspense) | SSR (suspense) |
| **streaming, `live: false`** (default) | SSR-streamed (pumped) | SSR-streamed (pumped) |
| **streaming, `live: true`** | client-only subscription | client-only subscription |

Both SSR and client-only streams are available route-bound and route-independent.
Route-independence does NOT imply client-only; `live` decides SSR participation on
its own.

## Definition surface

```ts
// Route-independent. ctx = { c, signal, call }. No location, no params, no schemas.
export const serverLoaders = {
  config:   defineLoader(async ({ c }) => loadConfig(c)),                 // finite, SSR'd
  ticker:   defineLoader(async function* ({ signal }) { … }),            // SSR-streamed
  activity: defineLoader(async function* ({ signal }) { … }, { live: true }), // client-only
};

// Route-bound. serverRoute is the ONLY way to get URL info + page-tier auth.
const route = serverRoute('/movies/:id');
export const serverLoaders = {
  default: route.loader(async ({ location }) => getMovie(location.pathParams.id)),
  cast:    route.loader(async function* ({ location }) { … }),           // SSR-streamed
  roster:  route.loader(async function* ({ location }) { … }, { live: true }), // client-only
  similar: route.loader(fn, { params: ['genre'], searchSchema }),        // schemas live here
};
```

- **`defineLoader(fn, opts?)`**: `fn: (ctx: StandaloneCtx) => Promise<T> | AsyncGenerator<T>`
  where `StandaloneCtx = { c: Context; signal: AbortSignal; call: ServerCaller['call'] }`.
  `opts: { live?: boolean; cache?; use?; timeoutMs? }`. No `location`, no
  `paramsSchema`/`searchSchema`/`params` (no params without a route), no route-form
  overload.
- **`serverRoute('/r/:id').loader(fn, opts?)`**: ctx carries typed `location`
  (`pathParams` from the route pattern, `searchParams`). `opts` is the loader opts
  PLUS `searchSchema`/`paramsSchema`/`params` AND now `{ live }` (today it omits
  `live`; that omission is removed so route-bound client-only streams are
  expressible). The `.liveLoader` method is removed in favor of the `liveStream`
  helper composed into `.loader` (see below).
- **`serverLoaders` is the single discovery export.** Both kinds live there; the
  ref carries the route binding intrinsically. `serverStreams` is deleted.

### `liveStream` channel helper

`liveStream({ topic, load })` is an optional **pure generator helper** producing
the channel-rerun body (yield `load(ctx)`, then re-run and push on every publish to
`topic(ctx)`). It composes into either constructor and is decoupled from `live`:

```ts
defineLoader(liveStream({ topic, load }), { live: true });          // standalone
serverRoute('/rooms/:id').loader(liveStream({ topic, load }), { live: true }); // route-bound
```

This replaces the current `serverRoute(r).liveLoader({...})` method. Because
`liveStream` returns an `async function*`, the streaming inference picks it up with
no special-casing. The route-bound case may require annotating the ctx in
`topic`/`load` (the inference cost of the pure-helper shape, accepted). The current
route-bound `liveLoader` method is removed in favor of `route.loader(liveStream(...))`.

## Consumption: unified under `.View` / `useData`

One consumption convention everywhere, now usable outside the router:

- Finite loader → single-value `loader.View(render)` / `loader.useData()` /
  `loader.Boundary`. SSR-eligible (suspends, server-renders).
- Streaming loader → `loader.View(({ data }) => …)` where `data` is the latest
  chunk, or the accumulating `loader.View(render, { initial, reduce })` for custom
  accumulation (e.g. a capped buffer). Renders fallback then fills.

The single-value vs accumulating `.View` form is gated by the streaming discriminant
inferred from the body (replacing today's `Live` type parameter on
`LoaderRef<T, Live>` with a streaming discriminant inferred from the function's
return type). `useEventStream` is deleted; route-independent streams are consumed
via the same `.View`. SSR-eligibility is a property of the consumption form plus the
`live` flag: a streaming loader with `live: true` (or any loader consumed via the
accumulating form) renders its fallback on SSR and subscribes client-side; a finite
single-value `.View` suspends and server-renders.

## Server engine + RPC folding

- **One handler, one path.** `streamsHandler`, `/__streams`, and `serverStreams`
  are **deleted**. Everything dispatches through `loadersHandler` on `/__loaders`,
  reading `serverLoaders`. The handler already inspects the call result
  (`isAsyncGenerator` → SSE, else JSON), so finite-vs-streaming on the wire is
  unchanged.
- **Runtime route marker drives chain composition (the P0 auth boundary).**
  `serverRoute(r)` stamps a **runtime** route marker on the refs it builds (today
  the route id is type-level-only / inert; it becomes a real runtime value). The
  handler:
  - **route-bound** loader → composes `[app, resolvePageUse(routePath), unit]` and
    requires a path; a route-bound loader invoked without a resolvable route is
    rejected, never run through a guard-less chain (the #178 lesson). Guards are
    resolved from the unit's **own declared route**, not from a client-sent path.
  - **route-independent** loader → composes `[app, unit]`, ignores location.
- **`live` is read only by the SSR host**, to skip pumping the generator into the
  document (render fallback) for client-only streams. It is not a wire concern.
- **Codegen shrinks.** `serverStreams` drops out of the recognized-export set,
  `stub-templates`, `server-only`, and validation. The existing loader stub
  (`{ __moduleKey, __loaderName }`) serves route-independent loaders too (they
  simply send no location).

## What dissolves from PR #212 / #127

Deleted: `defineStream`, `useEventStream`, `internal/sse-subscription.ts`,
`StreamRef`/`StreamCtx`/`DefineStreamOptions` (the stream-specific public types),
`serverStreams` (export name + codegen), `STREAMS_RPC_PATH`/`FORM_STREAM_FIELD`,
`streams-handler.ts`, the `/__streams` route registration, and the
`event-streams.mdx` guide.

Reused / retained: `internal/sse-events.ts` (the lifted SSE classification, now
shared by the loader path only), the server SSE pump (`sse.ts`, `stream-pump.ts`),
the client SSE reader (`readSSE`), and the `live`-loader accumulating `.View` +
`StreamState` ADT (generalized to all streaming loaders).

The held PR #212 is reshaped onto this design rather than merged.

## Migration (clean break)

This is a breaking redesign of the loader surface; pre-1.0, no deprecation shims.

- Remove the `defineLoader('/r/:id', fn)` route-form overload. Route binding is
  `serverRoute` only.
- Remove `location` from bare `defineLoader`'s ctx, and remove
  `paramsSchema`/`searchSchema`/`params` from `defineLoader` opts (they move to
  `serverRoute(r).loader`).
- Migrate the codebase's route-coupled bare loaders to `serverRoute(r).loader` in
  the same PR (e.g. `apps/site` movie/demo loaders that read `location`).
- Convert the demo activity bar to a route-independent streaming `defineLoader`
  (it currently rides the old live-loader `.View` pattern; PR #212 had converted it
  to `useEventStream`, which is now reverted into the loader form).
- Update the loaders guide (`apps/site/src/pages/docs/loaders.mdx`) and delete the
  `event-streams.mdx` guide; the loaders guide documents the inversion, the `live`
  flag, and the streaming-lifecycle matrix.

## Stacked follow-up (documented, NOT in this spec's scope)

**Remove explicit `server:` registration from `routes.ts`.** With route-binding
declared inside each `*.server.ts` via `serverRoute`, the `server: () => import(...)`
lines in `routes.ts` become redundant:

- Discovery moves to a glob (`import.meta.glob('**/*.server.ts')`). This is also
  required for route-independent loaders, which have no route node to register under.
- Route association + page-tier guard resolution come from the unit's declared
  `serverRoute` path (the runtime route marker this spec introduces), resolved
  against the route tree's `use` chain. This is more secure than today (guards bind
  to the unit's declared route, not a client-sent path).
- The route **tree** (paths, `view`/`layout`, `use`) stays in `routes.ts`.
- **Blocker to resolve in that follow-up:** actions have no `serverRoute` binding
  today (`serverActions` is page-associated purely by the registration). A
  route-bound action needs a `serverRoute(r).action(...)` (or equivalent) so it
  resolves guards from its declared route; otherwise dropping the registration would
  let an action be dispatched under a weaker-guarded path (an auth-selection bypass).

This follow-up rides the runtime-route-marker foundation from this spec and is its
own spec/PR, stacked on the inversion, so the inversion stays reviewable on its own.

## Testing

- Type-level: `defineLoader` overloads discriminate `AsyncGenerator` vs `Promise`
  return into streaming vs finite `LoaderRef` (replacing the `Live` param);
  `serverRoute(r).loader` types `location.pathParams` from the route; bare
  `defineLoader` ctx has no `location` (a `@ts-expect-error` asserting `location`
  is absent). `{ live }` accepted on both.
- Server: the one `loadersHandler` composes `[app, page, unit]` for a route-bound
  loader and `[app, unit]` for a route-independent loader (chain-order tests with
  real `defineServerMiddleware`, the P0). A route-bound loader with no resolvable
  route is rejected (no guard-less run). Streaming loaders respond SSE, finite JSON.
- SSR: a `live: false` streaming loader is pumped during SSR (chunks in the HTML);
  a `live: true` streaming loader renders fallback on SSR and is not pumped.
- Client: streaming `.View` accumulates (latest-chunk and `{ initial, reduce }`
  forms); route-independent loader `.View` survives navigation and works outside the
  router.
- Migration: the converted demo loaders behave identically (replacement parity);
  the deleted stream surface leaves no dangling references; the vite codegen no
  longer recognizes `serverStreams`.

## Public API surface delta

- Removed: `defineStream`, `useEventStream`, `StreamRef`, `StreamCtx`,
  `StreamFn`, `DefineStreamOptions`, `AnyStreamRef`, `UseEventStreamOptions`,
  `UseEventStreamResult`, `EventStreamStatus`, the `serverStreams` build export,
  `STREAMS_RPC_PATH`. The `defineLoader('/r/:id', fn)` route-form and bare-loader
  `location`/`paramsSchema`/`searchSchema`.
- Changed: `defineLoader` ctx and opts (route-independent shape); `LoaderRef`
  streaming discriminant inferred from the body; `serverRoute(r).loader` accepts
  `{ live }`; `serverRoute(r).liveLoader` removed in favor of `liveStream` composed
  into `.loader`.
- Added: `liveStream` (channel generator helper); `{ live }` on the unified loader
  opts; route-independent loader consumption via `.View`/`useData` outside the
  router.

## Open questions / risks

- **Hand-rolled infinite route generator without `live: true`** would hang the SSR
  pump. Mitigation: a dev-mode guard/timeout that flags a route-bound generator that
  neither completes nor sets `live`.
- **`liveStream` route-bound ctx inference** may need a ctx annotation in
  `topic`/`load`; acceptable per the pure-helper choice, but worth confirming the DX
  in the plan.
- **Runtime route marker** must be threaded by the vite module-key plugin the same
  way `__moduleKey`/`__loaderName` are, and validated (a route-bound loader whose
  declared route does not match the tree must fail loudly).
