import {
  _defineRouteLoader,
  LIVE_STREAM_MARKER,
  type DefineLoaderOptions,
  type Loader,
  type LoaderCtx,
  type LoaderRef,
  type LoaderSchemaOptions,
  type ParamsFromOptions,
  type SearchFromOptions,
} from './define-loader.js';
import type {
  RegisteredPaths,
  RegisteredSubtrees,
  RouteParams,
} from './internal/typed-routes.js';
import type { Topic } from './define-channel.js';
import { subscribeTopic } from './internal/subscribe-topic.js';
import {
  _defineRouteSocket,
  type SocketHandler,
  type SocketRef,
} from './define-socket.js';
import {
  _defineRouteRoom,
  type RoomHandler,
  type RoomRef,
} from './define-room.js';
import type { Channel } from './define-channel.js';
import {
  _defineRouteAction,
  type ActionFn,
  type ActionRef,
  type DefineActionOptions,
} from './action.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * A pure generator helper for channel-driven live loaders. Yields `load(ctx)`
 * once on connect, then re-runs and yields again on every `publish` to
 * `topic(ctx)`. Compose it with `defineLoader` or `route.loader`:
 *
 * ```ts
 * route.loader(liveStream({ topic, load }))
 * ```
 *
 * `liveStream` is inherently live (unbounded channel subscription), so `live`
 * is inferred automatically. No `{ live: true }` flag needed. The returned
 * generator is an `AsyncGenerator<T>`, driving the `LoaderRef<T, true>` type
 * discriminant.
 *
 * Implementation note: the function is tagged at runtime with `LIVE_STREAM_MARKER`
 * via `Object.assign`. `makeLoaderRef` reads the marker via `isLiveStreamFn`
 * (plain `in` check, cast-free) to auto-set `live: true`. The declared return
 * type is the plain function type so TypeScript can propagate the contextual
 * type from `route.loader` back to infer `C` from the callback usages.
 */
export function liveStream<T, C extends { signal: AbortSignal }>(opts: {
  /** The channel topic this loader re-runs on. Build it with `channel.key(...)`. */
  topic: (ctx: C) => Topic<unknown>;
  /** Produce the data. Runs on first connect and on every publish to `topic`. */
  load: (ctx: C) => Promise<T>;
}): (ctx: C) => AsyncGenerator<T, void, unknown> {
  const gen = async function* (ctx: C) {
    yield await opts.load(ctx);
    for await (const _ of subscribeTopic(opts.topic(ctx), ctx.signal)) {
      yield await opts.load(ctx);
    }
  };
  // Stamp the marker on the function in place so isLiveStreamFn (which uses
  // `LIVE_STREAM_MARKER in fn`) can detect it in makeLoaderRef. Object.assign
  // mutates gen and returns the typed intersection, but the declared return
  // type is the plain function type to preserve TypeScript's contextual
  // inference of C at call sites (route.loader / defineLoader).
  Object.assign(gen, { [LIVE_STREAM_MARKER]: true as const });
  return gen;
}

export interface RouteBinder<RouteId extends string> {
  /**
   * Define a streaming loader bound to this route. `ctx.location.pathParams` is
   * typed from the route's pattern. The fn returns an `AsyncGenerator<T>`, which
   * drives the `LoaderRef<T, true>` type discriminant (accumulating `.View` only).
   * Pass `{ live: true }` to opt out of SSR (client-only subscription that never
   * runs during `renderToStringAsync`). When composing with `liveStream`, the
   * flag is inferred automatically; no explicit `{ live: true }` is needed.
   */
  loader<T, O extends LoaderSchemaOptions = {}>(
    fn: (
      ctx: LoaderCtx<
        ParamsFromOptions<O, RouteParams<RouteId>>,
        SearchFromOptions<O>
      >
    ) => AsyncGenerator<T, void, unknown>,
    opts?: DefineLoaderOptions<T> & O
  ): LoaderRef<T, true>;

  /**
   * Define a single-value loader bound to this route. `ctx.location.pathParams`
   * is typed from the route's pattern, so no per-loader route id or
   * `LoaderCtx<...>` annotation is needed. The fn returns a `Promise<T>`, which
   * drives the `LoaderRef<T, false>` type discriminant (single-value `.View`,
   * `Boundary`, and `useData`). Pass `{ live: true }` to opt out of SSR.
   */
  loader<T, O extends LoaderSchemaOptions = {}>(
    fn: (
      ctx: LoaderCtx<
        ParamsFromOptions<O, RouteParams<RouteId>>,
        SearchFromOptions<O>
      >
    ) => Promise<T>,
    opts?: DefineLoaderOptions<T> & O
  ): LoaderRef<T, false>;

  /**
   * Define a server action bound to this route. Consume with
   * `useAction(serverActions.x)`. Binding the route lets the page-actions
   * handler resolve this action's page-level `use` chain (auth gates) from this
   * EXACT route pattern rather than fuzzy-matching the POST URL, closing the
   * `/a/:x` vs `/a/:y` collision window that a bare `defineAction` is subject to.
   *
   * Unlike `.loader`, there is no `ctx.location`/param typing: an action's
   * `ActionCtx` carries only `c`, `signal`, and `call`, and the action reads its
   * data from the validated `payload`. The overloads therefore mirror
   * `defineAction`: pass `{ input }` to validate and infer the payload type.
   */
  action<TInput extends StandardSchemaV1, TResult, TChunk = never>(
    fn: ActionFn<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>,
    opts: DefineActionOptions<TChunk, TResult> & { input: TInput }
  ): ActionRef<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>;
  action<TPayload, TResult, TChunk = never>(
    fn: ActionFn<TPayload, TResult, TChunk>,
    opts?: DefineActionOptions<TChunk, TResult>
  ): ActionRef<TPayload, TResult, TChunk>;

  /**
   * Define a duplex WebSocket bound to this route. Consume with
   * `useSocket(serverSockets.x, { params })`. Binding selects the route's
   * page-level `use` (auth) chain for the upgrade guard probe AND, for a
   * param-bearing route, requires the client to supply the route params via a
   * typed `params` option. Those params are validated at the upgrade (a missing
   * slot denies 4403), read by the guard as `ctx.location.pathParams`, and
   * passed to the edge `data` factory as its second argument. The declared
   * pattern is stamped on the def and validated fail-closed at boot: the boot
   * check also rejects (throws, does not just deny) a route whose `:param`
   * segment does not conform to the shared param grammar (e.g. a hyphen, as in
   * `:board-id`), since such a segment would otherwise resolve NO required
   * params and pass the guard an empty object for a param the same guard sees
   * populated over plain HTTP.
   */
  socket<Incoming, Outgoing, Data = undefined>(
    handler: SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>
  ): SocketRef<Incoming, Outgoing, RouteParams<RouteId>>;

  /**
   * Define a broadcasting room bound to this route, addressed by a `Channel`.
   * Consume it with the rooms client hook. `ctx.params` in `onJoin` is typed
   * from the CHANNEL name pattern (e.g. `defineChannel('room/:roomId')`), not
   * the route's pattern: the room key rides the wire (the `&r=channel.key(...)`
   * query param), so the channel is the only param source available at runtime
   * on the flat socket endpoint. Binding the route wires the room's page-level
   * `use` inheritance: the declared pattern is stamped on the def, validated
   * fail-closed at boot (the same non-conforming-`:param` rejection `.socket`
   * documents above), and takes precedence over the module-mount derivation
   * when the upgrade guard chain is resolved.
   *
   * Boot ALSO enforces route/channel param congruence on a route that has at
   * least one `use` guard: every one of the route's own `:param` names must
   * also be a `:param` of the CHANNEL (the channel may be finer-grained, never
   * coarser), because a guard on this route can read `ctx.location.pathParams`
   * under the route's param names, and those values come from the channel key,
   * not the route. A guard-less param-bearing route is exempt (there is no
   * guard for a name mismatch to fool), but binding to a channel that does not
   * carry the route's resource identity is still a correctness hazard even
   * without a guard; keep the names aligned regardless.
   */
  room<
    Name extends string,
    Payload,
    State = void,
    Data = Record<string, unknown>,
  >(
    channel: Channel<Name, Payload>,
    handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>
  ): RoomRef<Payload, Payload, State, RouteParams<Name>>;
}

/**
 * Bind a server module to its route once. `route.loader(fn)` then infers
 * `ctx.location.pathParams` from the route's pattern; the route id
 * autocompletes and validates against your registered routes. For a
 * channel-driven live subscription that re-pushes on publish, compose with
 * `liveStream`:
 *
 * ```ts
 * const route = serverRoute('/movies/:id');
 * export const serverLoaders = {
 *   default: route.loader(async ({ location }) => getMovie(location.pathParams.id)),
 *   live: route.loader(liveStream({ topic, load })),
 * };
 * ```
 *
 * The route string is forwarded to `_defineRouteLoader` as its `__routeId`,
 * which the server dispatcher uses to match route-bound loaders. The Vite
 * module-key plugin recognizes `route.loader(...)` calls in `serverLoaders`
 * and threads the module key just as it does for `defineLoader`.
 *
 * A layout or grouping node's SUBTREE binds with the wildcard spelling,
 * `serverRoute('/movies/*')`: the returned binder resolves the `use` chain
 * every descendant of `/movies` inherits (ancestors outer-first, then the
 * node's own `use`), without the index child's additions. The exact path
 * (`serverRoute('/movies')`) is the page scope, the pattern's deepest
 * composed chain. `RouteParams` of a wildcard pattern are the prefix params
 * only, matching the derived layout location the loader receives.
 */
export function serverRoute<
  const RouteId extends RegisteredPaths | RegisteredSubtrees,
>(route: RouteId): RouteBinder<RouteId> {
  return {
    loader: (fn: Loader<unknown>, opts?: DefineLoaderOptions<unknown>) =>
      _defineRouteLoader(route, fn, opts),
    action: (
      fn: ActionFn<unknown, unknown, unknown>,
      opts?: DefineActionOptions<unknown, unknown>
    ) => _defineRouteAction(route, fn, opts),
    socket: (handler) => _defineRouteSocket(route, handler),
    room: (channel, handler) => _defineRouteRoom(route, channel, handler),
  };
}
