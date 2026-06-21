import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';

// The per-runtime WebSocket upgrader (Hono's UpgradeWebSocket shape). Installed
// at boot by the adapter wrapper (Node: createNodeWebSocket({app}).upgradeWebSocket;
// Cloudflare in a later release). createServerEntry reads it lazily at request
// time when handling GET /__sockets. Mirrors the installPubSubBackend seam: the
// Vite adapter is build-time only and cannot supply this directly.
export type WebSocketUpgrader = (
  createEvents: (c: Context) => WSEvents | Promise<WSEvents>
) => MiddlewareHandler;

let current: WebSocketUpgrader | null = null;

export function installWebSocketUpgrader(upgrader: WebSocketUpgrader): void {
  current = upgrader;
}

export function getWebSocketUpgrader(): WebSocketUpgrader {
  if (!current) {
    throw new Error(
      'hono-preact: no WebSocket upgrader installed. serverSockets require a ' +
        'WS-capable adapter (the Node adapter installs one at boot).'
    );
  }
  return current;
}

/** Test-only reset. */
export function __resetWebSocketUpgraderForTesting(): void {
  current = null;
}
