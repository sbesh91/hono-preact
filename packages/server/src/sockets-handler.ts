import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKETS_RPC_PATH,
  WS_DENY_CODE,
  getWebSocketUpgrader,
} from '@hono-preact/iso/internal/runtime';
import { runRequestScope, dispatchServer } from '@hono-preact/iso/internal';
import type { AppConfig, ServerLoaderCtx } from '@hono-preact/iso';
import type { SocketDef, RoomDef } from '@hono-preact/iso/internal';
import { composeServerChain } from './compose-server-chain.js';
import { createRoomWsEvents } from './rooms-handler.js';

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
 * `mod.__moduleKey` and `mod.serverSockets`. Plain duplex sockets only: a
 * room def (which carries a `channel`) is filtered out here and picked up by
 * `buildRoomRegistry` instead, so the two registries partition `serverSockets`
 * by the channel discriminator.
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
        // A room def carries a `channel`; it belongs to the room registry, not
        // here. Filtering on the discriminator keeps one `serverSockets` map
        // the single source for both, with no second codegen export.
        if (val && typeof val === 'object' && !('channel' in val)) {
          registry.set(`${moduleKey}::${name}`, val as AnySocketDef);
        }
      }
    }
  }
  return registry;
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
   * Page-layer `use` resolver. When provided, the route-node `use` chain is
   * composed as the middle layer (outer -> inner: app-use, page-use, def.use),
   * which is where route/layout auth gates live. Defaults to returning `[]`
   * (no page-layer guards) when omitted.
   */
  resolvePageUse?: (
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
}): Promise<boolean> {
  const { def, ctx, appConfig, resolvePageUse, routePath, moduleKey, name } =
    opts;

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
    location: { path: routePath, pathParams: {}, searchParams: {} },
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

  return guardResult.kind === 'outcome';
}

/**
 * Handle GET /__sockets for BOTH duplex sockets and broadcasting rooms. Resolve
 * the connection's `m::name` against the socket registry first, then the room
 * registry; run the shared guard chain (app use + route-node use + the def's
 * use) before upgrading; then branch the post-guard WSEvents wiring on the
 * resolved def's shape. A guard denial upgrades and then immediately closes
 * WS_DENY_CODE in onOpen (a rejected handshake is opaque in browsers, so we
 * cannot refuse the HTTP upgrade).
 */
export function socketsHandler(opts: SocketsHandlerOptions): MiddlewareHandler {
  const { appConfig } = opts;
  return (c, next) => {
    // Lazy: the adapter installs the upgrader at boot, after this handler is
    // registered. Resolve it per request, not at construction time.
    const upgrade = getWebSocketUpgrader();

    const createEvents = async (ctx: Context): Promise<WSEvents> => {
      const moduleKey = ctx.req.query(SOCKET_MODULE_PARAM);
      const name = ctx.req.query(SOCKET_NAME_PARAM);
      const key = moduleKey && name ? `${moduleKey}::${name}` : undefined;

      // Resolve sockets first, then rooms. The two registries partition the
      // serverSockets map by the channel discriminator, so a key matches at
      // most one.
      const socketDef = key ? opts.registry.get(key) : undefined;
      const roomDef = key ? opts.rooms?.get(key) : undefined;
      const def: AnySocketDef | AnyRoomDef | undefined = socketDef ?? roomDef;

      if (!def) {
        return {
          onOpen(_e, ws) {
            ws.close(WS_DENY_CODE, 'unknown socket');
          },
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

      const denied = await resolveGuardDenied({
        def,
        ctx,
        appConfig,
        resolvePageUse: opts.resolvePageUse ?? (() => []),
        routePath,
        moduleKey: moduleKey ?? '',
        name: name ?? '',
      });

      // Branch on the def shape. A room def carries a `channel`; delegate its
      // (larger) wiring to the room runtime to keep this file thin.
      if ('channel' in def) {
        return createRoomWsEvents(def, { ctx, denied });
      }

      // --- Plain duplex socket wiring (unchanged from Task 2). ---
      let teardown: (() => void) | void;
      const data: Record<string, unknown> = {};
      const makeSocket = (ws: {
        send(d: string): void;
        close(c?: number, r?: string): void;
      }) => ({
        send: (msg: unknown) => ws.send(JSON.stringify(msg)),
        close: (code?: number, reason?: string) => ws.close(code, reason),
        data,
        raw: ws,
      });

      return {
        async onOpen(_e, ws) {
          if (denied) {
            ws.close(WS_DENY_CODE, 'forbidden');
            return;
          }
          const result = await socketDef!.open?.(makeSocket(ws), { c: ctx });
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
          const msg = JSON.parse(raw); // sanctioned untrusted-JSON boundary
          await socketDef!.message?.(makeSocket(ws), msg);
        },
        onClose(ev, ws) {
          teardown?.();
          socketDef!.close?.(makeSocket(ws), {
            code: ev.code,
            reason: ev.reason,
          });
        },
        onError(ev, ws) {
          // Unwrap the real error if the event carries one (ErrorEvent shape);
          // fall back to the event itself so no information is discarded.
          const err =
            ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
          socketDef!.error?.(makeSocket(ws), err);
        },
      };
    };

    return upgrade(createEvents)(c, next);
  };
}
