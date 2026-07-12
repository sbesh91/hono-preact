import type { Context } from 'hono';
import {
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_ROOM_PARAM,
  SOCKETS_RPC_PATH,
} from '@hono-preact/iso/internal/runtime';
import { runRequestScope, dispatchServer } from '@hono-preact/iso/internal';
import type { AppConfig, ServerLoaderCtx } from '@hono-preact/iso';
import type { SocketDef, RoomDef } from '@hono-preact/iso/internal';
import { composeServerChain } from './compose-server-chain.js';
import { resolveRoomKey } from './rooms-handler.js';
import type { RoomKeyResolution } from './rooms-handler.js';

type GlobModule = {
  __moduleKey?: unknown;
  serverSockets?: unknown;
  [key: string]: unknown;
};
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

export type AnySocketDef = SocketDef<unknown, unknown, unknown>;
export type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;

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
  /**
   * Dev mode. When true, the Node upgrade path warns (rather than silently
   * accepting) a data-factory result that would exceed the 6KB forward budget
   * on Cloudflare, surfacing a CF-only failure during local development. The
   * generated server entry passes `{ dev: import.meta.env.DEV }`.
   */
  dev?: boolean;
  /**
   * Page-layer `use` resolver. The route-node `use` chain is composed as the
   * middle layer (outer -> inner: app-use, page-use, def.use), which is where
   * route/layout auth gates live.
   *
   * Called with the socket's OWN owning-route PATTERN (from `resolveRoutePath`),
   * not a concrete URL, so pass `pageUseResolver.byPattern` (exact key lookup),
   * NOT `byPath`: the URL fuzzy-matcher can resolve a pattern to a sibling
   * same-shaped pattern's guards (`/a/:x` vs `/a/:y`), applying the wrong route's
   * auth gates to the upgrade.
   *
   * REQUIRED: page-level `use` is where route/layout auth gates live, so an
   * absent resolver would silently drop them on the socket-upgrade path,
   * letting a connection bypass the gate that protects the owning route. The
   * handler validates this at construction and throws rather than upgrading
   * through a guard-less chain, mirroring `loadersHandler` /
   * `pageActionsHandler`.
   */
  resolvePageUse: (
    path: string
  ) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;
  /**
   * Resolve a socket's moduleKey to its owning route path so that
   * `resolvePageUse` receives the correct path when the def carries no
   * declared `__routeId` (bare `defineSocket`/`defineRoom`); a stamped
   * declared pattern takes precedence. When the moduleKey is not found in the
   * route tree (a bare `defineSocket` not attached to a route node) the
   * resolver returns `undefined` and the handler falls back to
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
   * (the `/__sockets` endpoint is query-string only, with no param wire). A
   * declared route binding does not change this: binding selects the use
   * chain, never the param wire, so a guard on a param-bearing bound pattern
   * still sees `{}` for plain sockets.
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
 * The fully-resolved state for a `/__sockets` connection, as a discriminated
 * union so the dispatch reads each variant's payload without non-null
 * assertions:
 *
 * - `unknown`: the `m::name` matched no socket and no room registry.
 * - `socket`: a plain duplex socket. `socketDef` is always present.
 * - `room`: a broadcasting room. `roomDef` and the pre-resolved `roomKey` are
 *   always present (`roomKey.ok` still distinguishes a valid key from a failed
 *   parse).
 *
 * Single-sourced so the Node `createEvents` path and the CF connector branch
 * read the SAME resolution (def lookup, route-path derivation, room-key parse,
 * guard probe) rather than copy-pasting it and drifting.
 */
export type ResolvedConnection =
  | { kind: 'unknown' }
  | {
      kind: 'socket';
      socketDef: AnySocketDef;
      moduleKey: string | undefined;
      name: string | undefined;
      denied: boolean;
    }
  | {
      kind: 'room';
      roomDef: AnyRoomDef;
      roomKey: RoomKeyResolution;
      moduleKey: string | undefined;
      name: string | undefined;
      denied: boolean;
    };

/**
 * Resolve a `/__sockets` connection's def, owning route path, room key, and
 * guard outcome from the request Context. This is the shared resolution that
 * BOTH the in-worker Node path (`createEvents`) and the CF connector branch run,
 * so the auth/permission resolution is single-sourced and cannot drift between
 * the two dispatch targets. It performs no connection side effects (no upgrade,
 * no WSEvents wiring); it only reads the request and runs the guard probe.
 */
export async function resolveConnection(
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

  if (!def) return { kind: 'unknown' };

  // The def's declared pattern (serverRoute(r).socket/.room stamps __routeId)
  // wins when present: the boot binding guard validates it against the module
  // mount (or the route table for src/server registry modules) before the
  // entry serves, so the byPattern lookup cannot fail open for a bound def.
  // The module-mount derivation is the fallback for bare defs; a bare def
  // whose moduleKey is not in the route tree falls back to SOCKETS_RPC_PATH,
  // which matches no route pattern, so resolvePageUse returns [] and the def
  // gets app-use + def-use only.
  const routePath =
    def.__routeId ??
    (moduleKey && opts.resolveRoutePath
      ? (opts.resolveRoutePath(moduleKey) ?? SOCKETS_RPC_PATH)
      : SOCKETS_RPC_PATH);

  // `'channel' in def` narrows `def` to a room, so the room branch carries the
  // resolved `roomKey` with no non-null assertion and the socket branch carries
  // a present `socketDef`.
  if ('channel' in def) {
    // For a room, parse + validate the room-key params SERVER-SIDE before the
    // guard runs, so the guard chain (app -> route-node -> def use) can read
    // them via `ctx.location.pathParams`. The topic is computed server-side here
    // (channel.key(params)); the client only varies param VALUES.
    const roomKey = resolveRoomKey(
      def.channel,
      ctx.req.query(SOCKET_ROOM_PARAM)
    );
    const denied = await resolveGuardDenied({
      def,
      ctx,
      appConfig,
      resolvePageUse: opts.resolvePageUse,
      routePath,
      moduleKey: moduleKey ?? '',
      name: name ?? '',
      // Only feed resolved params to the guard; a failed room-key resolution
      // contributes no params. onOpen still denies on a failed room key, so the
      // guard never sees a partially-resolved room.
      pathParams: roomKey.ok ? roomKey.params : {},
    });
    return { kind: 'room', roomDef: def, roomKey, moduleKey, name, denied };
  }

  // Plain socket: no param wire, so the guard gets `{}` path params.
  const denied = await resolveGuardDenied({
    def,
    ctx,
    appConfig,
    resolvePageUse: opts.resolvePageUse,
    routePath,
    moduleKey: moduleKey ?? '',
    name: name ?? '',
    pathParams: {},
  });
  return { kind: 'socket', socketDef: def, moduleKey, name, denied };
}
