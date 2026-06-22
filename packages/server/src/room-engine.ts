import type {
  RoomDef,
  RoomEnvelope,
  RoomClientFrame,
} from '@hono-preact/iso/internal';
import type { RoomConnection } from '@hono-preact/iso';

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;
type AnyEnvelope = RoomEnvelope<unknown, unknown>;
type AnyFrame = RoomClientFrame<unknown, unknown>;

/**
 * The transport-agnostic room engine.
 *
 * The engine owns the room PROTOCOL: the snapshot/delta envelope construction,
 * the fan-out RULES, the client-frame routing, and the join/message/leave
 * sequence. It is pure of platform (no pub/sub, no presence registry, no hono):
 * everything platform-specific is funneled through the `RoomTransport` a caller
 * supplies. A Node runtime (`rooms-handler.ts`) and a Cloudflare Durable Object
 * runtime each implement `RoomTransport` differently, but drive the SAME engine.
 *
 * The fan-out rules the engine encodes (preserved exactly from the PR 4 Node
 * implementation, now centralized):
 *  - The initial snapshot is sent DIRECTLY to the joiner (`sendTo`), never
 *    broadcast (other members must not re-receive the whole roster).
 *  - A `'msg'` broadcast excludes the sender. The engine expresses this by
 *    passing `excludeConnId = self` to `broadcast`. On Node the exclusion is
 *    realized RECEIVER-side (each connection's own subscribe callback skips its
 *    own `'msg'` echoes by `env.from`); on Cloudflare the DO honors
 *    `excludeConnId` directly. Either way the engine's contract is the same.
 *  - `broadcast(msg, { self: true })` additionally does a direct `sendTo(self)`
 *    so the sender also receives its own message (no wire flag on the envelope).
 *  - Presence deltas (join/update/leave) are ALWAYS broadcast to the topic; the
 *    sender's own presence echo is harmless (the client dedupes by member id).
 */
export interface RoomTransport {
  /** The acting connection's stable member id (used for `conn.id` / self). */
  readonly connId: string;
  /**
   * Send an envelope DIRECTLY to one connection. In every engine use this is
   * the acting connection itself (the snapshot to the joiner, a `conn.send`,
   * and the `{ self: true }` broadcast copy), so `connId === this.connId`.
   */
  sendTo(connId: string, env: AnyEnvelope): void;
  /**
   * Broadcast an envelope to the room. `excludeConnId`, when given, is the
   * connection that must NOT receive it (the sender, for a `'msg'` broadcast).
   * Presence deltas pass no exclusion (everyone gets them).
   */
  broadcast(env: AnyEnvelope, excludeConnId?: string): void;
  /** Add the connection to the roster with its initial presence state. */
  joinPresence(connId: string, state: unknown): void;
  /** Remove the connection from the roster. */
  leavePresence(connId: string): void;
  /** Replace the connection's presence state in the roster. */
  updatePresence(connId: string, state: unknown): void;
  /** The current roster as `{ id, state }[]`. */
  roster(): Array<{ id: string; state: unknown }>;
  /** The edge-captured per-connection data (seeds `conn.data`). */
  data(connId: string): unknown;
}

/** Build a 'msg' envelope from a sender id and an application message. */
function envMsg(from: string, msg: unknown): AnyEnvelope {
  return { from, t: 'msg', msg };
}

/** Build a presence-delta envelope. */
function envPresence(
  from: string,
  op: 'join' | 'update' | 'leave',
  state: unknown
): AnyEnvelope {
  // `leave` never carries state; `join`/`update` carry it (which may be absent
  // on the wire for a void-state room, since JSON.stringify drops undefined).
  if (op === 'leave') return { from, t: 'presence', op };
  return { from, t: 'presence', op, state };
}

/**
 * Build the `RoomConnection` handed to a room's user callbacks from a transport.
 *
 * `close` is transport-specific (the engine never closes a connection itself),
 * so the caller supplies it. Everything else routes through the transport:
 *  - `send`     -> `sendTo(self, msg-env)` (this connection only).
 *  - `broadcast`-> `broadcast(msg-env, exclude self)`; `{ self: true }` also
 *                  `sendTo(self, msg-env)` (the sender's direct copy).
 *  - `setPresence` -> `updatePresence` + `broadcast(presence/update)`.
 *  - `data`     -> the edge-captured per-connection data.
 */
export function makeRoomConnection(
  t: RoomTransport,
  close: (code?: number, reason?: string) => void
): RoomConnection<unknown, unknown, unknown> {
  const self = t.connId;
  return {
    id: self,
    data: t.data(self),
    close,
    send: (msg) => t.sendTo(self, envMsg(self, msg)),
    broadcast: (msg, opts) => {
      t.broadcast(envMsg(self, msg), self);
      if (opts?.self) t.sendTo(self, envMsg(self, msg));
    },
    setPresence: (state) => {
      t.updatePresence(self, state);
      t.broadcast(envPresence(self, 'update', state));
    },
  };
}

/**
 * Run the join sequence for the acting connection:
 *  1. Seed presence with the room default (may be undefined) and join the
 *     roster.
 *  2. Send the joiner the full roster snapshot DIRECTLY (not broadcast).
 *  3. Broadcast a presence/join to the topic, excluding the joiner.
 *  4. Build the `RoomConnection` and run `def.onJoin`; return its teardown.
 *
 * The caller (the transport runtime) owns connection lifecycle (subscribe,
 * close) and runs the returned teardown on leave; the engine only sequences the
 * protocol.
 */
export async function engineJoin(
  t: RoomTransport,
  def: AnyRoomDef,
  params: Record<string, string>,
  close: (code?: number, reason?: string) => void
): Promise<(() => void) | void> {
  const self = t.connId;

  // 1. Seed presence with the server default (may be undefined) and join.
  const initialState = def.presence?.();
  t.joinPresence(self, initialState);

  // 2. Send the joiner the full roster snapshot DIRECTLY (not broadcast: other
  //    members must not re-receive the whole roster).
  const snapshot: AnyEnvelope = {
    t: 'snapshot',
    self,
    members: t.roster(),
  };
  t.sendTo(self, snapshot);

  // 3. Announce the join to the topic, excluding the joiner. Presence deltas
  //    are forwarded to everyone else; the client dedupes by member id.
  t.broadcast(envPresence(self, 'join', initialState), self);

  // 4. Build the connection handle and run the user's join hook.
  const conn = makeRoomConnection(t, close);
  return def.onJoin?.(conn, { params });
}

/**
 * Route an inbound client frame for the acting connection. Mirrors the PR 4
 * ultrareview hardening exactly:
 *  - try/catch JSON.parse: a malformed (non-JSON) frame is a silent no-op (so
 *    an async handler does not reject with an unhandled rejection).
 *  - `{ t: 'presence' }`: framework-handled. Update the roster + broadcast a
 *    presence/update. Does NOT route through `onMessage`.
 *  - `{ t: 'msg' }`: hand the inner payload to `def.onMessage`.
 *  - any other `t`: dropped (do NOT fall through to `onMessage` with an
 *    undefined payload, which the old implicit-else `t === 'msg'` did).
 *
 * `conn` is rebuilt from the transport so the engine stays stateless; the
 * transport's `data(self)` returns the same edge-captured bag, so `conn.data`
 * is identical to the one `onJoin` saw.
 */
export async function engineMessage(
  t: RoomTransport,
  def: AnyRoomDef,
  rawFrame: string,
  close: (code?: number, reason?: string) => void
): Promise<void> {
  const self = t.connId;
  let frame: AnyFrame;
  try {
    frame = JSON.parse(rawFrame) as AnyFrame; // sanctioned untrusted-JSON boundary
  } catch {
    // A malformed (non-JSON) frame would otherwise reject this async handler
    // with an unhandled rejection. Drop it silently.
    return;
  }
  if (frame.t === 'presence') {
    // Framework-handled presence update (does NOT go through onMessage):
    // same effect as conn.setPresence(state).
    t.updatePresence(self, frame.state);
    t.broadcast(envPresence(self, 'update', frame.state));
    return;
  }
  if (frame.t === 'msg') {
    // An application message: hand the inner payload to the user handler.
    const conn = makeRoomConnection(t, close);
    await def.onMessage?.(conn, frame.msg);
    return;
  }
  // Unknown `t`: silently drop. Do NOT fall through to onMessage with an
  // undefined payload (the old implicit-else assumed `t === 'msg'`).
}

/**
 * Run the leave sequence for the acting connection: remove the connection from
 * the roster and broadcast a presence/leave to the room. This is the protocol
 * half of the leave sequence; it does NOT call `def.onLeave`. Each transport
 * runtime calls `def.onLeave` itself, after `engineClose`, `unsub`, and the
 * `onJoin`-returned teardown, so the leave hook always runs last.
 */
export function engineClose(
  t: RoomTransport,
  _def: AnyRoomDef,
  _close: (code?: number, reason?: string) => void
): void {
  const self = t.connId;
  t.leavePresence(self);
  t.broadcast(envPresence(self, 'leave', undefined));
}
