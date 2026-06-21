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
import type { AppConfig } from '@hono-preact/iso';
import type { SocketDef } from '@hono-preact/iso/internal';
import { composeServerChain } from './compose-server-chain.js';

type GlobModule = {
  __moduleKey?: unknown;
  serverSockets?: unknown;
  [key: string]: unknown;
};
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

/**
 * Build the `${moduleKey}::${name}` -> SocketDef registry from the route
 * server modules. Mirrors buildLoadersMap in loaders-handler.ts, reading
 * `mod.__moduleKey` and `mod.serverSockets`.
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

export interface SocketsHandlerOptions {
  registry: Map<string, AnySocketDef>;
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
 * Handle GET /__sockets. Resolve the socket by module key + name, run its
 * guard chain (app use + the socket's use) before upgrading, and wire the
 * connection handlers through a JSON serialize boundary. A guard denial
 * upgrades and then immediately closes WS_DENY_CODE in onOpen (a rejected
 * handshake is opaque in browsers, so we cannot refuse the HTTP upgrade).
 */
export function socketsHandler(opts: SocketsHandlerOptions): MiddlewareHandler {
  const { appConfig } = opts;
  return (c, next) => {
    // Lazy: the adapter installs the upgrader at boot, after this handler
    // is registered. Resolve it per request, not at construction time.
    const upgrade = getWebSocketUpgrader();

    const createEvents = async (ctx: Context): Promise<WSEvents> => {
      const moduleKey = ctx.req.query(SOCKET_MODULE_PARAM);
      const name = ctx.req.query(SOCKET_NAME_PARAM);
      const def =
        moduleKey && name
          ? opts.registry.get(`${moduleKey}::${name}`)
          : undefined;

      if (!def) {
        return {
          onOpen(_e, ws) {
            ws.close(WS_DENY_CODE, 'unknown socket');
          },
        };
      }

      // Resolve the owning route path from the moduleKey (server-derived, not
      // client-supplied). A socket whose moduleKey is not in the route tree
      // (a bare defineSocket not attached to a route node) falls back to
      // SOCKETS_RPC_PATH, which matches no route pattern, so resolvePageUse
      // returns [] and the socket gets app-use + def-use only.
      const routePath =
        moduleKey && opts.resolveRoutePath
          ? (opts.resolveRoutePath(moduleKey) ?? SOCKETS_RPC_PATH)
          : SOCKETS_RPC_PATH;

      // Run the guard chain (app use + page/route-node use + socket's use)
      // before the connection goes live. Mirrors loaders-handler.ts's
      // composeServerChain usage. Chain order: app-use (outermost), page-use
      // (route-node use gates), def.use (innermost). Guards run as 'loader'
      // scope since the socket upgrade is an HTTP GET request carrying a Hono
      // Context; the scope tag is unused by the middleware engine itself.
      const { serverMw, signal } = await composeServerChain<'loader'>({
        requestSignal: ctx.req.raw.signal,
        unitTimeoutMs: undefined,
        defaultTimeoutMs: false,
        appConfig,
        resolvePageUse: opts.resolvePageUse ?? (() => []),
        path: routePath,
        unitUse: def.use ?? [],
      });

      // Dispatch the guard chain with a no-op inner to probe for a deny
      // outcome. Only `kind: 'outcome'` matters here; the inner value is
      // discarded. Mirrors how loadersHandler detects a deny (dispatch.kind).
      const ctx4403: import('@hono-preact/iso').ServerLoaderCtx = {
        scope: 'loader',
        c: ctx,
        signal,
        location: { path: routePath, pathParams: {}, searchParams: {} },
        module: moduleKey ?? '',
        loader: name ?? '',
      };
      const guardResult = await runRequestScope(
        () =>
          dispatchServer<true, 'loader'>({
            middleware: serverMw,
            ctx: ctx4403,
            inner: async () => true as const,
          }),
        { honoContext: ctx }
      );

      const denied = guardResult.kind === 'outcome';

      // Per-connection state: teardown returned by def.open, and a data bag.
      let teardown: (() => void) | void;
      const data: Record<string, unknown> = {};

      // Wrap the raw WS so socket.send JSON-stringifies and socket.data is
      // per-connection. Type is purposely narrow here: we only use what WSS
      // exposes (send, close); the escape hatch is socket.raw = ws itself.
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
          const result = await def.open?.(makeSocket(ws), { c: ctx });
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
          await def.message?.(makeSocket(ws), msg);
        },
        onClose(ev, ws) {
          teardown?.();
          def.close?.(makeSocket(ws), {
            code: ev.code,
            reason: ev.reason,
          });
        },
        onError(ev, ws) {
          // Unwrap the real error if the event carries one (ErrorEvent shape);
          // fall back to the event itself so no information is discarded.
          const err =
            ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
          def.error?.(makeSocket(ws), err);
        },
      };
    };

    return upgrade(createEvents)(c, next);
  };
}
