import type { Context } from 'hono';

// The per-deployment realtime connector seam. Mirrors the `installWebSocketUpgrader`
// seam in ws-upgrader.ts (module-level `current`, install/get). The default (no
// connector installed) keeps today's in-worker Node room runtime: socketsHandler
// runs `createRoomWsEvents` in-process. The Cloudflare adapter installs a
// connector that forwards the upgrade to a Durable Object instead of running the
// room runtime in the worker.
//
// The connector is invoked ONLY for a room connection that passed the guard chain
// at the edge. socketsHandler resolves the def + room key + guard server-side
// BEFORE calling the connector, so no unauthorized connection reaches the DO; a
// denied room and a plain socket never reach the connector.

/**
 * The resolved context handed to a realtime connector for an allowed room
 * connection. Everything here is server-derived at the edge: the topic is always
 * `channel.key(params)` computed server-side, and `data` is the already-run
 * `roomDef.data?.(c)` result (run at the edge with the live Context, since on
 * Cloudflare the room callbacks run inside a Durable Object with no live Context).
 */
export interface RoomConnectContext {
  c: Context;
  topic: string;
  moduleKey: string;
  name: string;
  params: Record<string, string>;
  data: unknown; // result of roomDef.data?.(c), already run at the edge
}

/**
 * A realtime connector forwards an allowed room upgrade somewhere other than the
 * in-worker Node runtime (on Cloudflare: to a Durable Object). It returns the
 * upgrade Response (the forwarded `101`), which socketsHandler returns directly.
 */
export type RealtimeConnector = (
  ctx: RoomConnectContext
) => Response | Promise<Response>;

let current: RealtimeConnector | undefined;

export function installRealtimeConnector(connector: RealtimeConnector): void {
  current = connector;
}

/** `undefined` => no connector installed; use the in-worker Node room runtime. */
export function getRealtimeConnector(): RealtimeConnector | undefined {
  return current;
}

/** Test-only reset. */
export function __resetRealtimeConnectorForTesting(): void {
  current = undefined;
}
