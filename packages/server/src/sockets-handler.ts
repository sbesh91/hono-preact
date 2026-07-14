import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  WS_DENY_CODE,
  getWebSocketUpgrader,
  getRealtimeConnector,
} from '@hono-preact/iso/internal/runtime';
import { warnIfOverForwardBudget } from './realtime-budget.js';
import { createRoomWsEvents } from './rooms-handler.js';
import { makeServerSocketHandle } from './server-socket-handle.js';
import { assertPageUseResolver } from './page-use-guard.js';
import { resolveConnection } from './socket-resolution.js';
import type {
  ResolvedConnection,
  SocketsHandlerOptions,
} from './socket-resolution.js';

// Re-export the resolution surface so existing `./sockets-handler.js` importers
// (create-server-entry, the CF internal entry, tests) keep their import paths.
export {
  buildSocketRegistry,
  assertNoSocketRoomCollision,
  resolveGuardDenied,
} from './socket-resolution.js';
export type { GuardedDef, SocketsHandlerOptions } from './socket-resolution.js';

/**
 * Handle GET /__sockets for BOTH duplex sockets and broadcasting rooms. Resolve
 * the connection's `m::name` against the socket registry first, then the room
 * registry (via `resolveConnection`); run the shared guard chain (app use +
 * route-node use + the def's use) before upgrading; then branch the post-guard
 * WSEvents wiring on the resolved variant. A guard denial upgrades and then
 * immediately closes WS_DENY_CODE in onOpen (a rejected handshake is opaque in
 * browsers, so we cannot refuse the HTTP upgrade).
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
  assertPageUseResolver(opts?.resolvePageUse, {
    handler: 'socketsHandler',
    option: 'opts.resolvePageUse',
    surface: 'socket upgrade path',
  });
  return async (c, next) => {
    const createEvents = async (
      ctx: Context,
      preResolved?: ResolvedConnection
    ): Promise<WSEvents> => {
      const resolved = preResolved ?? (await resolveConnection(ctx, opts));

      if (resolved.kind === 'unknown') {
        return {
          onOpen(_e, ws) {
            ws.close(WS_DENY_CODE, 'unknown socket');
          },
        };
      }

      // A room def carries a `channel`; delegate its (larger) wiring to the room
      // runtime to keep this file thin. The pre-resolved room key is threaded in
      // so onOpen does not re-parse.
      if (resolved.kind === 'room') {
        return createRoomWsEvents(resolved.roomDef, {
          ctx,
          denied: resolved.denied,
          roomKey: resolved.roomKey,
          dev: opts.dev ?? false,
        });
      }

      // --- Plain duplex socket wiring. ---
      const { socketDef, denied, params } = resolved;
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
      // define-socket). `params` is the resolved route params (`{}` for an
      // unbound socket, the validated wire params for a route-bound one).
      const data: unknown = denied
        ? undefined
        : socketDef.data
          ? await socketDef.data(ctx, params)
          : undefined;
      warnIfOverForwardBudget(data, opts.dev ?? false, 'socket');

      return {
        async onOpen(_e, ws) {
          if (denied) {
            ws.close(WS_DENY_CODE, 'forbidden');
            return;
          }
          const result = await socketDef.open?.(
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
          await socketDef.message?.(makeServerSocketHandle(ws, data), msg);
        },
        onClose(ev, ws) {
          if (denied) return;
          teardown?.();
          socketDef.close?.(makeServerSocketHandle(ws, data), {
            code: ev.code,
            reason: ev.reason,
          });
        },
        onError(ev, ws) {
          if (denied) return;
          const err =
            ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
          socketDef.error?.(makeServerSocketHandle(ws, data), err);
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

    if (resolved.kind === 'room') {
      // Room: the connector handles both dispositions so the deny close can use
      // a transport-native API (WebSocketPair on workerd) that this platform-
      // neutral file cannot import.
      const { roomDef, roomKey, denied, moduleKey, name } = resolved;
      if (denied || !roomKey.ok) {
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
      const data = await roomDef.data?.(c);
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
    if (resolved.kind === 'unknown' || resolved.denied) {
      return connector({ c, kind: 'deny' });
    }
    const { socketDef, moduleKey, name, params } = resolved;
    // `params` is the resolved route params; see the matching Node-path
    // comment above.
    const data = socketDef.data ? await socketDef.data(c, params) : undefined;
    return connector({
      c,
      kind: 'socket-forward',
      moduleKey: moduleKey ?? '',
      name: name ?? '',
      data,
    });
  };
}
