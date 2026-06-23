import type { Context } from 'hono';

// The per-deployment realtime connector seam. Mirrors the `installWebSocketUpgrader`
// seam in ws-upgrader.ts (module-level `current`, install/get). The default (no
// connector installed) keeps today's in-worker Node room runtime: socketsHandler
// runs `createRoomWsEvents` in-process. The Cloudflare adapter installs a
// connector that forwards the upgrade to a Durable Object instead of running the
// room runtime in the worker.
//
// The connector is invoked for a ROOM or SOCKET connection.
// socketsHandler resolves the def + room key + guard (rooms) or socket callbacks
// (sockets) server-side at the edge and hands the connector a discriminated `kind`:
//   - `forward`: an allowed, key-resolved room. The connector forwards it to the
//     room runtime (on Cloudflare: a Durable Object).
//   - `socket-forward`: an allowed socket. The connector mints a fresh per-
//     connection Durable Object and forwards the socket.
//   - `deny`: a denied / key-failed room or socket. The connector performs a
//     transport-native deny close (on Cloudflare: a WebSocketPair closed
//     WS_DENY_CODE) WITHOUT contacting the runtime / DO.
// The deny close lives behind the connector seam because it needs transport-
// native APIs (`WebSocketPair` on workerd) that the platform-neutral
// socketsHandler cannot import. The guard runs BEFORE either path, so no
// unauthorized connection ever reaches the DO; the `deny` path closes the
// handshake without any DO contact.

/** Per-connection fields shared by every connector invocation. */
interface RealtimeConnectBase {
  c: Context;
}

/**
 * An allowed, key-resolved room connection to forward. Everything here is
 * server-derived at the edge: the topic is always `channel.key(params)` computed
 * server-side, and `data` is the already-run `roomDef.data?.(c)` result (run at
 * the edge with the live Context, since on Cloudflare the room callbacks run
 * inside a Durable Object with no live Context).
 */
export interface RoomForwardContext extends RealtimeConnectBase {
  kind: 'forward';
  topic: string;
  moduleKey: string;
  name: string;
  params: Record<string, string>;
  data: unknown; // result of roomDef.data?.(c), already run at the edge
}

/**
 * An allowed plain duplex socket to forward. A plain socket has no topic
 * identity (no fan-out), so the connector mints a fresh per-connection Durable
 * Object. `data` is the already-run `socketDef.data?.(c)` result (run at the
 * edge with the live Context, since the socket callbacks run inside the DO with
 * no live Context).
 */
export interface SocketForwardContext extends RealtimeConnectBase {
  kind: 'socket-forward';
  moduleKey: string;
  name: string;
  data: unknown; // result of socketDef.data?.(c), already run at the edge
}

/**
 * A denied or key-failed connection (room or socket). The connector performs a
 * transport-native deny close (WS_DENY_CODE) without contacting the runtime, so
 * a denied connection never reaches a Durable Object.
 */
export interface DenyContext extends RealtimeConnectBase {
  kind: 'deny';
}

/**
 * The resolved context handed to a realtime connector. The `kind` discriminant
 * selects forward-to-room-DO, forward-to-socket-DO, or transport-native deny.
 */
export type RealtimeConnectContext =
  | RoomForwardContext
  | SocketForwardContext
  | DenyContext;

/**
 * A realtime connector handles a room or socket upgrade off the in-worker Node
 * runtime (on Cloudflare: a Durable Object). For a `forward` or `socket-forward`
 * it returns the upgrade Response (the forwarded `101`); for a `deny` it returns
 * a transport-native upgrade-and-close Response (the client's socket closes
 * WS_DENY_CODE). socketsHandler returns the Response directly.
 */
export type RealtimeConnector = (
  ctx: RealtimeConnectContext
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
