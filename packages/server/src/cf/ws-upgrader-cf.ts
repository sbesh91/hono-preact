/// <reference types="@cloudflare/workers-types/latest" />
import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import { WSContext } from 'hono/ws';
import type { WebSocketUpgrader } from '@hono-preact/iso/internal/runtime';

/**
 * A Cloudflare WebSocket upgrader for the raw `upgradeWebSocket` helper, with
 * Node parity. Unlike `hono/cloudflare-workers`' upgradeWebSocket, it fires
 * `onOpen` after `server.accept()`, so a raw `upgradeWebSocket` route behaves
 * identically on Node and Cloudflare. Each call mints its own `WebSocketPair`:
 * a per-connection duplex socket needs no Durable Object (the DO exists only for
 * cross-connection fan-out and hibernation state, which a raw socket does not use).
 *
 * Installed into the WebSocket-upgrader seam by the Cloudflare adapter's
 * generated worker entry, symmetric to how the Node adapter installs
 * `createNodeWebSocket({ app }).upgradeWebSocket`. Independent of the realtime
 * connector: `/__sockets` (defineSocket / rooms) routes through the connector
 * and never reaches this upgrader.
 */

// Run a user WS handler so a throw is logged, not propagated. On Cloudflare an
// unguarded onOpen throw (it runs before the 101 Response is returned) would
// abort the handshake, while Node swallows it and keeps the connection open.
// Mirrors @hono/node-ws and the socket open() wrapper in realtime-do.ts.
function runGuarded(run: () => void): void {
  try {
    run();
  } catch (e) {
    console.error(e);
  }
}

export function makeCfWebSocketUpgrader(): WebSocketUpgrader {
  return (
    createEvents: (c: Context) => WSEvents | Promise<WSEvents>
  ): MiddlewareHandler => {
    return async (c, next) => {
      // Case-insensitive per RFC 6455 (and matching @hono/node-ws), so a client
      // sending `Upgrade: WebSocket` upgrades on Cloudflare just as on Node.
      if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
        await next();
        return;
      }
      const events = await createEvents(c);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const ws = new WSContext<WebSocket>({
        close: (code, reason) => server.close(code, reason),
        get protocol() {
          return server.protocol;
        },
        raw: server,
        get readyState() {
          return server.readyState;
        },
        // The workerd server socket has no meaningful `url`; use the request URL
        // so `ws.url` carries the same value handlers see on Node (@hono/node-ws).
        url: new URL(c.req.url),
        send: (source) => server.send(source),
      });
      if (events.onMessage) {
        server.addEventListener('message', (evt) =>
          runGuarded(() => events.onMessage?.(evt, ws))
        );
      }
      if (events.onClose) {
        server.addEventListener('close', (evt) =>
          runGuarded(() => events.onClose?.(evt, ws))
        );
      }
      if (events.onError) {
        server.addEventListener('error', (evt) =>
          runGuarded(() => events.onError?.(evt, ws))
        );
      }
      server.accept();
      runGuarded(() => events.onOpen?.(new Event('open'), ws));
      return new Response(null, { status: 101, webSocket: client });
    };
  };
}
