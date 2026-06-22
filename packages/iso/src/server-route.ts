import {
  defineLoader,
  type DefineLoaderOpts,
  type Loader,
  type LoaderCtx,
  type LoaderRef,
  type LoaderSchemaOpts,
  type ParamsFromOpts,
  type SearchFromOpts,
} from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
import type { Topic } from './define-channel.js';
import { subscribeTopic } from './internal/subscribe-topic.js';
import {
  defineSocket,
  type SocketHandler,
  type SocketRef,
} from './define-socket.js';
import { defineRoom, type RoomHandler, type RoomRef } from './define-room.js';
import type { Channel } from './define-channel.js';

/** Options for a channel-driven live loader bound to a route. */
export interface LiveLoaderOpts<T, TParams> {
  /** The channel topic this loader re-runs on. Build it with `channel.key(...)`. */
  topic: (ctx: LoaderCtx<TParams>) => Topic<unknown>;
  /** Produce the data. Runs on first connect and on every publish to `topic`. */
  load: (ctx: LoaderCtx<TParams>) => Promise<T>;
  cache?: LoaderCache<T>;
  use?: DefineLoaderOpts<T>['use'];
  timeoutMs?: number | false;
  // Threaded by the Vite module-key plugin; not set by hand.
  __moduleKey?: string;
  __loaderName?: string;
}

export interface RouteServer<RouteId extends string> {
  /**
   * Define a non-live loader bound to this route. `ctx.location.pathParams` is
   * typed from the route's pattern, so no per-loader route id or `LoaderCtx<...>`
   * annotation is needed. For a channel-driven live subscription that re-pushes
   * on publish, use `liveLoader` instead.
   */
  loader<T, O extends LoaderSchemaOpts = {}>(
    fn: Loader<T, ParamsFromOpts<O, RouteParams<RouteId>>, SearchFromOpts<O>>,
    opts?: Omit<DefineLoaderOpts<T>, 'live'> & O
  ): LoaderRef<T, false>;

  /**
   * A channel-driven live loader. Yields `load(ctx)` once, then re-runs and
   * pushes it on every `publish` to `topic(ctx)`. Consume it via the
   * accumulating form: `ref.View(render, { initial, reduce })`.
   */
  liveLoader<T>(
    opts: LiveLoaderOpts<T, RouteParams<RouteId>>
  ): LoaderRef<T, true>;

  /**
   * Define a duplex WebSocket bound to this route. Consume with
   * `useSocket(serverSockets.x)`. The handler receives `ctx.c` (the Hono
   * Context for the upgrade request); there is no `ctx.params` field because
   * the socket endpoint is query-string-only at runtime. Typed route params
   * for sockets are reserved for a later release (rooms).
   */
  socket<Incoming, Outgoing, Data = undefined>(
    handler: SocketHandler<Incoming, Outgoing, Data>
  ): SocketRef<Incoming, Outgoing>;

  /**
   * Define a broadcasting room bound to this route, addressed by a `Channel`.
   * Consume it with the rooms client hook. `ctx.params` in `onJoin` is typed
   * from the CHANNEL name pattern (e.g. `defineChannel('room/:roomId')`), not
   * the route's pattern: the room key rides the wire (the `&r=channel.key(...)`
   * query param), so the channel is the only param source available at runtime
   * on the flat socket endpoint. Attaching the room to the route node only
   * wires its `use` inheritance.
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
 * Bind a server module to its route once. `route.loader(fn)` and
 * `route.liveLoader({ topic, load })` then infer `ctx.location.pathParams` from
 * the route's pattern; the route id autocompletes and validates against your
 * registered routes.
 *
 * ```ts
 * const route = serverRoute('/movies/:id');
 * export const serverLoaders = {
 *   default: route.loader(async ({ location }) => getMovie(location.pathParams.id)),
 * };
 * ```
 *
 * The route id is type-level only (inert at runtime). The Vite module-key plugin
 * recognizes `route.loader(...)` and `route.liveLoader(...)` calls in
 * `serverLoaders` and threads the module key just as it does for `defineLoader`.
 */
export function serverRoute<const RouteId extends RegisteredPaths>(
  route: RouteId
): RouteServer<RouteId> {
  return {
    loader: (fn, opts) => defineLoader(route, fn, opts),
    socket: (handler) => defineSocket(handler),
    room: (channel, handler) => defineRoom(channel, handler),
    liveLoader: <T>({
      topic,
      load,
      cache,
      use,
      timeoutMs,
      __moduleKey,
      __loaderName,
    }: LiveLoaderOpts<T, RouteParams<RouteId>>) => {
      const gen: Loader<T, RouteParams<RouteId>> = async function* (
        ctx
      ): AsyncGenerator<T, void, unknown> {
        yield await load(ctx);
        const t = topic(ctx);
        // Coarse re-run: the subscription starts here, after the initial load.
        // A publish that races the initial load is not separately replayed; the
        // next publish re-runs load and reads current state.
        for await (const _ of subscribeTopic(t, ctx.signal)) {
          yield await load(ctx);
        }
      };
      return defineLoader(route, gen, {
        live: true,
        cache,
        use,
        timeoutMs,
        __moduleKey,
        __loaderName,
      });
    },
  };
}
