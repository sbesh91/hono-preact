import {
  defineLoader,
  type DefineLoaderOpts,
  type Loader,
  type LoaderCtx,
  type LoaderRef,
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
  loader<T>(
    fn: Loader<T, RouteParams<RouteId>>,
    opts?: Omit<DefineLoaderOpts<T>, 'live'>
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
   * Define a duplex WebSocket bound to this route. `ctx.params` is typed from
   * the route's pattern. Consume with `useSocket(serverSockets.x)`.
   */
  socket<Incoming, Outgoing, Data = undefined>(
    handler: SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>
  ): SocketRef<Incoming, Outgoing>;
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
