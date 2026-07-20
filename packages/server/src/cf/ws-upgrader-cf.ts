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
export function makeCfWebSocketUpgrader(): WebSocketUpgrader {
  return (
    createEvents: (c: Context) => WSEvents | Promise<WSEvents>
  ): MiddlewareHandler => {
    return async (c, next) => {
      if (c.req.header('Upgrade') !== 'websocket') {
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
        url: server.url ? new URL(server.url) : null,
        send: (source) => server.send(source),
      });
      if (events.onMessage) {
        server.addEventListener('message', (evt) =>
          events.onMessage?.(evt, ws)
        );
      }
      if (events.onClose) {
        server.addEventListener('close', (evt) => events.onClose?.(evt, ws));
      }
      if (events.onError) {
        server.addEventListener('error', (evt) => events.onError?.(evt, ws));
      }
      server.accept();
      events.onOpen?.(new Event('open'), ws);
      return new Response(null, { status: 101, webSocket: client });
    };
  };
}
