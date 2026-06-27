import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_ROOM_PARAM,
  SOCKETS_RPC_PATH,
  WS_DENY_CODE,
  getWebSocketUpgrader,
  getRealtimeConnector,
} from '@hono-preact/iso/internal/runtime';
import { runRequestScope, dispatchServer } from '@hono-preact/iso/internal';
import type { AppConfig, ServerLoaderCtx } from '@hono-preact/iso';
import type { SocketDef, RoomDef } from '@hono-preact/iso/internal';
import { composeServerChain } from './compose-server-chain.js';
import { createRoomWsEvents, resolveRoomKey } from './rooms-handler.js';
import type { RoomKeyResolution } from './rooms-handler.js';
import { makeServerSocketHandle } from './server-socket-handle.js';

type GlobModule = {
  __moduleKey?: unknown;
  serverSockets?: unknown;
  [key: string]: unknown;
};
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

type AnySocketDef = SocketDef<unknown, unknown, unknown>;
type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;

/** A def with an optional guard chain (both SocketDef and RoomDef have one). */
export interface GuardedDef {
  use?: ReadonlyArray<unknown>;
}

/**
 * Build the `${moduleKey}::${name}` -> SocketDef registry from the route
 * server modules. Mirrors buildLoadersMap in loaders-handler.ts, reading
 * `mod.__moduleKey` and `mod.serverSockets`. Plain duplex sockets only: rooms
 * come from the SEPARATE `serverRooms` export and are built by
 * `buildRoomRegistry`. Every object value under `serverSockets` is a socket
 * def; no filtering is needed here.
 */
export async function buildSocketRegistry(
  serverImports: LazyArray
): Promise<Map<string, AnySocketDef>> {
  const registry = new Map<string, AnySocketDef>();
  for (const [, loader] of Object.entries(serverImports)) {
    const mod =
      typeof loader === 'function'
        ? await (loader as () => Promise<GlobModule>)()
        : (loader as GlobModule);
    const moduleKey = mod.__moduleKey;
    if (typeof moduleKey !== 'string') continue;

    const sockets = mod.serverSockets;
    if (sockets && typeof sockets === 'object') {
      for (const [name, val] of Object.entries(sockets)) {
        if (val && typeof val === 'object') {
          registry.set(`${moduleKey}::${name}`, val as AnySocketDef);
        }
      }
    }
  }
  return registry;
}

/**
 * Fail loudly when a socket and a room share the same `${moduleKey}::${name}`
 * key. The two registries are keyed identically, and `socketsHandler` resolves
 * the socket first (`socketDef ?? roomDef`), so a collision would silently
 * shadow the room (it becomes unreachable). A name must be unique across
 * `serverSockets` and `serverRooms` within a module; throw at boot rather than
 * leave a connection mysteriously routed to the wrong def.
 *
 * Called from `createServerEntry` where both registries resolve together, so it
 * runs once at boot (or per registry rebuild in dev) rather than per connection.
 */
export function assertNoSocketRoomCollision(
  registry: Map<string, AnySocketDef>,
  rooms: Map<string, AnyRoomDef> | undefined
): void {
  if (!rooms) return;
  for (const key of registry.keys()) {
    if (rooms.has(key)) {
      // key is `${moduleKey}::${name}`.
      throw new Error(
        `Realtime name collision on "${key}": a socket (serverSockets) and a ` +
          `room (serverRooms) cannot share a name within the same module. ` +
          `Rename one of them so each ${'`moduleKey::name`'} key is unique.`
      );
    }
  }
}

export interface SocketsHandlerOptions {
  registry: Map<string, AnySocketDef>;
  /**
   * Room registry (built by `buildRoomRegistry`). Rooms ride the same
   * `/__sockets` endpoint and the same guard chain; the only divergence is the
   * post-guard WSEvents wiring, which branches on the resolved def's shape.
   */
  rooms?: Map<string, AnyRoomDef>;
  appConfig?: AppConfig;
  // `dev` (registry freshness) is the caller's responsibility; not read here.
  /**
   * Page-layer `use` resolver. The route-node `use` chain is composed as the
   * middle layer (outer -> inner: app-use, page-use, def.use), which is where
   * route/layout auth gates live.
   *
   * REQUIRED: page-level `use` is where route/layout auth gates live, so an
   * absent resolver would silently drop them on the socket-upgrade path,
   * letting a connection bypass the gate that protects the owning route. The
   * handler validates this at construction and throws rather than upgrading
   * through a guard-less chain, mirroring `loadersHandler` /
   * `pageActionsHandler`. Pass `pageUseResolver.byPath` from
   * `makePageUseResolver`.
   */
  resolvePageUse: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Resolve a socket's moduleKey to its owning route path so that
   * `resolvePageUse` receives the correct path. When the moduleKey is not
   * found in the route tree (a bare `defineSocket` not attached to a route
   * node) the resolver returns `undefined` and the handler falls back to
   * `SOCKETS_RPC_PATH`, which matches no route pattern, so `resolvePageUse`
   * returns `[]` and the socket gets app-use + def-use only.
   */
  resolveRoutePath?: (moduleKey: string) => string | undefined;
}

/**
 * Resolve the guard chain (app use + route-node use + the def's own use) for a
 * socket OR room connection and run it with a no-op inner to probe for a deny.
 * Returns `true` when a guard denied the connection. Shared verbatim by the
 * socket and room branches so the auth/permission path is single-sourced; only
 * the post-guard WSEvents wiring differs between the two.
 */
export async function resolveGuardDenied(opts: {
  def: GuardedDef;
  ctx: Context;
  appConfig: AppConfig | undefined;
  resolvePageUse: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  routePath: string;
  moduleKey: string;
  name: string;
  /**
   * Path params the guard chain can read via `ctx.location.pathParams`. Rooms
   * pass their server-resolved room-key params here (so a route-node/room guard
   * can read e.g. `ctx.location.pathParams.roomId`); plain sockets pass `{}`
   * (the `/__sockets` endpoint is query-string only, with no param wire).
   */
  pathParams?: Record<string, string>;
}): Promise<boolean> {
  const {
    def,
    ctx,
    appConfig,
    resolvePageUse,
    routePath,
    moduleKey,
    name,
    pathParams = {},
  } = opts;

  // Chain order is outer -> inner: app-use, page/route-node use, def.use.
  // Guards run as 'loader' scope since the upgrade is an HTTP GET carrying a
  // Hono Context; the scope tag is unused by the middleware engine itself.
  const { serverMw, signal } = await composeServerChain<'loader'>({
    requestSignal: ctx.req.raw.signal,
    unitTimeoutMs: undefined,
    defaultTimeoutMs: false,
    appConfig,
    resolvePageUse,
    path: routePath,
    unitUse: def.use ?? [],
  });

  // Dispatch the chain with a no-op inner: only `kind: 'outcome'` (a deny)
  // matters; the inner value is discarded. Mirrors loadersHandler's deny probe.
  const probeCtx: ServerLoaderCtx = {
    scope: 'loader',
    c: ctx,
    signal,
    location: { path: routePath, pathParams, searchParams: {} },
    module: moduleKey,
    loader: name,
  };
  const guardResult = await runRequestScope(
    () =>
      dispatchServer<true, 'loader'>({
        middleware: serverMw,
        ctx: probeCtx,
        inner: async () => true as const,
      }),
    { honoContext: ctx }
  );

  if (guardResult.kind !== 'outcome') return false;

  // Any guard outcome denies the upgrade: unlike the HTTP loader/action paths,
  // a WebSocket handshake cannot follow an HTTP redirect, so a redirecting
  // guard can only fail closed. That is correct, but it silently diverges from
  // the HTTP path, so surface it: a guard reused from an HTTP route that does
  // `redirect('/login')` would otherwise look like an inexplicable 4403.
  if (guardResult.outcome.__outcome === 'redirect') {
    console.warn(
      `hono-preact: a guard on the "${moduleKey}::${name}" WebSocket upgrade ` +
        'returned redirect(); a WebSocket handshake cannot follow an HTTP ' +
        'redirect, so the connection is closed (WS_DENY_CODE). Use deny() ' +
        'instead of redirect() in realtime guards.'
    );
  }

  return true;
}

/**
 * The fully-resolved state for a `/__sockets` connection: the def (socket and/or
 * room view of it), the server-derived owning route path, the pre-resolved room
 * key (rooms only), and whether the shared guard chain denied. `def` is
 * `undefined` only when the `m::name` matches no registry.
 *
 * Single-sourced so the Node `createEvents` path and the CF connector branch
 * read the SAME resolution (def lookup, route-path derivation, room-key parse,
 * guard probe) rather than copy-pasting it and drifting.
 */
interface ResolvedConnection {
  moduleKey: string | undefined;
  name: string | undefined;
  socketDef: AnySocketDef | undefined;
  roomDef: AnyRoomDef | undefined;
  def: AnySocketDef | AnyRoomDef | undefined;
  routePath: string;
  /** Defined iff `def` is a room (i.e. `'channel' in def`). */
  roomKey: RoomKeyResolution | undefined;
  denied: boolean;
}

/**
 * Resolve a `/__sockets` connection's def, owning route path, room key, and
 * guard outcome from the request Context. This is the shared resolution that
 * BOTH the in-worker Node path (`createEvents`) and the CF connector branch run,
 * so the auth/permission resolution is single-sourced and cannot drift between
 * the two dispatch targets. It performs no connection side effects (no upgrade,
 * no WSEvents wiring); it only reads the request and runs the guard probe.
 *
 * When the `m::name` matches no registry, `def` is `undefined` (the callers
 * handle the unknown-def deny). Otherwise `roomKey` is defined iff `def` is a
 * room (`'channel' in def`).
 */
async function resolveConnection(
  ctx: Context,
  opts: SocketsHandlerOptions
): Promise<ResolvedConnection> {
  const { appConfig } = opts;
  const moduleKey = ctx.req.query(SOCKET_MODULE_PARAM);
  const name = ctx.req.query(SOCKET_NAME_PARAM);
  const key = moduleKey && name ? `${moduleKey}::${name}` : undefined;

  // Resolve sockets first, then rooms. Sockets come from `serverSockets`
  // and rooms from the separate `serverRooms` export, so a key matches at
  // most one registry.
  const socketDef = key ? opts.registry.get(key) : undefined;
  const roomDef = key ? opts.rooms?.get(key) : undefined;
  const def: AnySocketDef | AnyRoomDef | undefined = socketDef ?? roomDef;

  if (!def) {
    return {
      moduleKey,
      name,
      socketDef: undefined,
      roomDef: undefined,
      def: undefined,
      routePath: SOCKETS_RPC_PATH,
      roomKey: undefined,
      denied: false,
    };
  }

  // Resolve the owning route path from the moduleKey (server-derived, not
  // client-supplied). A def whose moduleKey is not in the route tree falls
  // back to SOCKETS_RPC_PATH, which matches no route pattern, so
  // resolvePageUse returns [] and the def gets app-use + def-use only.
  const routePath =
    moduleKey && opts.resolveRoutePath
      ? (opts.resolveRoutePath(moduleKey) ?? SOCKETS_RPC_PATH)
      : SOCKETS_RPC_PATH;

  // For a room, parse + validate the room-key params SERVER-SIDE before the
  // guard runs, so the guard chain (app -> route-node -> def use) can read
  // them via `ctx.location.pathParams`. Plain sockets have no param wire, so
  // they pass `{}` to the guard. The topic is still computed server-side
  // here (channel.key(params)); the client only varies param VALUES.
  // `'channel' in def` narrows `def` to a room, so `roomKey` is defined iff
  // the room branch below runs (no non-null assertion needed there).
  let roomKey: RoomKeyResolution | undefined;
  if ('channel' in def) {
    roomKey = resolveRoomKey(def.channel, ctx.req.query(SOCKET_ROOM_PARAM));
  }

  const denied = await resolveGuardDenied({
    def,
    ctx,
    appConfig,
    resolvePageUse: opts.resolvePageUse,
    routePath,
    moduleKey: moduleKey ?? '',
    name: name ?? '',
    // Only feed resolved params to the guard; a failed room-key resolution
    // (or a plain socket) contributes no params. onOpen still denies on a
    // failed room key, so the guard never sees a partially-resolved room.
    pathParams: roomKey?.ok ? roomKey.params : {},
  });

  return {
    moduleKey,
    name,
    socketDef,
    roomDef,
    def,
    routePath,
    roomKey,
    denied,
  };
}

/**
 * Handle GET /__sockets for BOTH duplex sockets and broadcasting rooms. Resolve
 * the connection's `m::name` against the socket registry first, then the room
 * registry; run the shared guard chain (app use + route-node use + the def's
 * use) before upgrading; then branch the post-guard WSEvents wiring on the
 * resolved def's shape. A guard denial upgrades and then immediately closes
 * WS_DENY_CODE in onOpen (a rejected handshake is opaque in browsers, so we
 * cannot refuse the HTTP upgrade).
 *
 * Dispatch target: with NO realtime connector installed (the default) the room
 * runtime runs IN the worker (the Node path below, byte-identical to before the
 * connector seam). When a connector IS installed (the Cloudflare adapter
 * installs one), EVERY room connection goes through it (after the guard has run
 * at the edge): an allowed room is forwarded so the room runtime executes in a
 * Durable Object; a denied / key-failed room is closed WS_DENY_CODE by the
 * connector via a transport-native upgrade-and-close, with no DO contact. A
 * plain socket never reaches the connector (the in-worker upgrader handles it).
 */
export function socketsHandler(opts: SocketsHandlerOptions): MiddlewareHandler {
  if (typeof opts?.resolvePageUse !== 'function') {
    // page-level `use` carries route/layout auth gates; a missing resolver
    // would silently drop them on the socket-upgrade path, letting a
    // connection bypass the gate that protects the owning route. Fail loudly
    // at construction (the type also marks this required) instead of upgrading
    // through a guard-less chain. Mirrors loadersHandler / pageActionsHandler.
    throw new Error(
      'socketsHandler requires opts.resolvePageUse; without it page-level ' +
        'middleware (including auth gates) is silently dropped on the socket ' +
        'upgrade path. Pass makePageUseResolver(routes).byPath.'
    );
  }
  return async (c, next) => {
    const createEvents = async (
      ctx: Context,
      preResolved?: ResolvedConnection
    ): Promise<WSEvents> => {
      const { socketDef, def, denied, roomKey } =
        preResolved ?? (await resolveConnection(ctx, opts));

      if (!def) {
        return {
          onOpen(_e, ws) {
            ws.close(WS_DENY_CODE, 'unknown socket');
          },
        };
      }

      // Branch on the def shape. A room def carries a `channel`; delegate its
      // (larger) wiring to the room runtime to keep this file thin. The
      // pre-resolved room key is threaded in so onOpen does not re-parse.
      if ('channel' in def && roomKey) {
        return createRoomWsEvents(def, { ctx, denied, roomKey });
      }

      // --- Plain duplex socket wiring. ---
      let teardown: (() => void) | void;
      // socket.data is the edge `data` factory result, seeded HERE at connect
      // (after the guard resolved `denied`) so it is set before ANY handler
      // runs. createEvents is async, so a buffered early frame cannot reach
      // onMessage with socket.data still unseeded, even when the factory is
      // async. A denied connection never runs the factory (parity with the CF
      // edge); a factory returning null/undefined is honored verbatim (not
      // coerced to {}); no factory means undefined (the Data default). It is the
      // connect-time seed: on Node it is a closure object the handler may
      // mutate, but on Cloudflare it is NOT a cross-event mutable store (see
      // define-socket).
      const data: unknown = denied
        ? undefined
        : socketDef!.data
          ? await socketDef!.data(ctx)
          : undefined;

      return {
        async onOpen(_e, ws) {
          if (denied) {
            ws.close(WS_DENY_CODE, 'forbidden');
            return;
          }
          const result = await socketDef!.open?.(
            makeServerSocketHandle(ws, data)
          );
          teardown = typeof result === 'function' ? result : undefined;
        },
        async onMessage(ev, ws) {
          if (denied) return;
          const raw =
            typeof ev.data === 'string'
              ? ev.data
              : ev.data instanceof ArrayBuffer
                ? new TextDecoder().decode(ev.data)
                : await (ev.data as Blob).text();
          // Drop a malformed (non-JSON) frame instead of throwing out of the
          // handler (mirrors the room engine's frame parsing).
          let msg: unknown;
          try {
            msg = JSON.parse(raw);
          } catch {
            return;
          }
          await socketDef!.message?.(makeServerSocketHandle(ws, data), msg);
        },
        onClose(ev, ws) {
          if (denied) return;
          teardown?.();
          socketDef!.close?.(makeServerSocketHandle(ws, data), {
            code: ev.code,
            reason: ev.reason,
          });
        },
        onError(ev, ws) {
          if (denied) return;
          const err =
            ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
          socketDef!.error?.(makeServerSocketHandle(ws, data), err);
        },
      };
    };

    const connector = getRealtimeConnector();
    if (!connector) {
      // Node path (no connector installed): the room runtime runs IN the worker.
      // Byte-identical to before the connector seam: lazily resolve the upgrader
      // (the adapter installs it at boot, after this handler is registered) and
      // run the in-worker WSEvents factory for both sockets and rooms.
      const upgrade = getWebSocketUpgrader();
      return upgrade(createEvents)(c, next);
    }

    // CF path: a connector is installed. Resolve def + room key + guard at the
    // EDGE (the same resolution createEvents uses, via resolveConnection) so the
    // guard chain runs BEFORE the connector decides forward vs. deny. Every ROOM
    // connection (allowed or denied) goes THROUGH the connector; a non-room
    // (unknown def or a plain socket) uses the in-worker upgrader path.
    const resolved = await resolveConnection(c, opts);
    const { socketDef, roomDef, roomKey, denied, moduleKey, name } = resolved;

    if (roomDef) {
      // Room: the connector handles both dispositions so the deny close can use
      // a transport-native API (WebSocketPair on workerd) that this platform-
      // neutral file cannot import.
      if (denied || !roomKey || !roomKey.ok) {
        // Denied guard OR a failed room key. The guard ran BEFORE this point, so
        // a denied connection never reaches the connector's forward path / the
        // DO; the connector closes WS_DENY_CODE in the worker without any DO
        // contact. A failed key (topic/params never resolved) is denied the same
        // way. The connector returns the upgrade-and-close Response directly.
        return connector({ c, kind: 'deny' });
      }

      // Room + allowed + key-ok: run the edge `data` factory once (with the live
      // Context, since the room callbacks run without a Context inside the DO)
      // and forward to the connector. The connector returns the upgrade Response
      // (the forwarded 101); return it directly, NOT through upgrade().
      const data = (await roomDef.data?.(c)) ?? {};
      return connector({
        c,
        kind: 'forward',
        topic: roomKey.topic,
        moduleKey: moduleKey ?? '',
        name: name ?? '',
        params: roomKey.params,
        data,
      });
    }

    // Not a room. A connector is installed (CF). An allowed plain socket forwards
    // to a fresh per-connection Durable Object via the connector; the guard already
    // ran at the edge. A denied connection or an unknown def (no socket, no room)
    // closes via the connector's transport-native deny, with no DO contact.
    // getWebSocketUpgrader() is the Node (no-connector) path only; it is never
    // reached on a forwarding adapter.
    if (denied || !socketDef) {
      return connector({ c, kind: 'deny' });
    }
    const data = socketDef.data ? await socketDef.data(c) : undefined;
    return connector({
      c,
      kind: 'socket-forward',
      moduleKey: moduleKey ?? '',
      name: name ?? '',
      data,
    });
  };
}
