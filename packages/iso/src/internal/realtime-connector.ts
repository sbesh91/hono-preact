import type { Context } from 'hono';

// The per-deployment realtime connector seam. Mirrors the `installWebSocketUpgrader`
// seam in ws-upgrader.ts (module-level `current`, install/get). The default (no
// connector installed) keeps today's in-worker Node room runtime: socketsHandler
// runs `createRoomWsEvents` in-process. The Cloudflare adapter installs a
// connector that forwards the upgrade to a Durable Object instead of running the
// room runtime in the worker.
//
// The connector is invoked for a ROOM connection (the only kind it handles).
// socketsHandler resolves the def + room key + guard server-side at the edge and
// hands the connector a discriminated `kind`:
//   - `forward`: an allowed, key-resolved room. The connector forwards it to the
//     room runtime (on Cloudflare: a Durable Object).
//   - `deny`: a denied / key-failed room. The connector performs a transport-
//     native deny close (on Cloudflare: a WebSocketPair closed WS_DENY_CODE)
//     WITHOUT contacting the room runtime / DO.
// The deny close lives behind the connector seam because it needs transport-
// native APIs (`WebSocketPair` on workerd) that the platform-neutral
// socketsHandler cannot import. The guard runs BEFORE either path, so no
// unauthorized connection ever reaches the DO; the `deny` path closes the
// handshake without any DO contact.

/** Per-connection fields shared by every connector invocation. */
interface RoomConnectBase {
  c: Context;
}

/**
 * An allowed, key-resolved room connection to forward. Everything here is
 * server-derived at the edge: the topic is always `channel.key(params)` computed
 * server-side, and `data` is the already-run `roomDef.data?.(c)` result (run at
 * the edge with the live Context, since on Cloudflare the room callbacks run
 * inside a Durable Object with no live Context).
 */
export interface RoomForwardContext extends RoomConnectBase {
  kind: 'forward';
  topic: string;
  moduleKey: string;
  name: string;
  params: Record<string, string>;
  data: unknown; // result of roomDef.data?.(c), already run at the edge
}

/**
 * A denied or key-failed room connection. The connector performs a transport-
 * native deny close (close WS_DENY_CODE) without contacting the room runtime, so
 * a denied connection never reaches the Durable Object.
 */
export interface RoomDenyContext extends RoomConnectBase {
  kind: 'deny';
}

/**
 * The resolved context handed to a realtime connector. The `kind` discriminant
 * selects forward-to-runtime vs. transport-native deny close.
 */
export type RoomConnectContext = RoomForwardContext | RoomDenyContext;

/**
 * A realtime connector handles a room upgrade somewhere other than the in-worker
 * Node runtime (on Cloudflare: a Durable Object). For a `forward` it returns the
 * upgrade Response (the forwarded `101`); for a `deny` it returns a transport-
 * native upgrade-and-close Response (the client's socket closes WS_DENY_CODE).
 * socketsHandler returns the Response directly.
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
