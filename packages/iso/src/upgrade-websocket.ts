import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import { getWebSocketUpgrader } from './internal/ws-upgrader.js';

/**
 * Upgrade a route to a raw WebSocket using the framework's single connection
 * (the same one that powers serverSockets). Use in `api.ts` for hand-authored
 * WS routes:
 *
 *   app.get('/raw', upgradeWebSocket((c) => ({ onMessage(ev, ws) { ws.send('hi') } })));
 *
 * The upgrader is resolved lazily at request time so that api.ts can register
 * routes before the adapter wrapper has finished running installWebSocketUpgrader.
 */
export function upgradeWebSocket(
  createEvents: (c: Context) => WSEvents | Promise<WSEvents>
): MiddlewareHandler {
  return async (c, next) => {
    const handler = getWebSocketUpgrader()(createEvents);
    return handler(c, next);
  };
}
