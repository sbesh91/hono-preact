import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  SOCKET_ROOM_PARAM,
  WS_DENY_CODE,
  getPubSubBackend,
  joinRoom,
  leaveRoom,
  updatePresence,
  roomMembers,
} from '@hono-preact/iso/internal/runtime';
import type {
  RoomDef,
  RoomEnvelope,
  RoomClientFrame,
} from '@hono-preact/iso/internal';
import type { RoomConnection } from '@hono-preact/iso';

type GlobModule = {
  __moduleKey?: unknown;
  serverRooms?: unknown;
  [key: string]: unknown;
};
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;
type AnyEnvelope = RoomEnvelope<unknown, unknown>;
type AnyFrame = RoomClientFrame<unknown, unknown>;

/**
 * Build the `${moduleKey}::${name}` -> RoomDef registry from the route server
 * modules. Rooms come from the `serverRooms` named export, which is a DISTINCT
 * export from `serverSockets`. Mirrors `buildSocketRegistry`'s structure but
 * reads `mod.serverRooms` instead of `mod.serverSockets`. Every object value
 * under `serverRooms` is treated as a RoomDef; a defensive `'channel' in val`
 * check is kept as a sanity guard (a well-formed room def always carries
 * `channel`). The client codegen recognition for `serverRooms` is added in the
 * serverRooms-codegen task; the server reads the export directly here.
 */
export async function buildRoomRegistry(
  serverImports: LazyArray
): Promise<Map<string, AnyRoomDef>> {
  const registry = new Map<string, AnyRoomDef>();
  for (const [, loader] of Object.entries(serverImports)) {
    const mod =
      typeof loader === 'function'
        ? await (loader as () => Promise<GlobModule>)()
        : (loader as GlobModule);
    const moduleKey = mod.__moduleKey;
    if (typeof moduleKey !== 'string') continue;

    const rooms = mod.serverRooms;
    if (rooms && typeof rooms === 'object') {
      for (const [name, val] of Object.entries(rooms)) {
        // Sanity check: a well-formed room def always carries `channel`.
        if (val && typeof val === 'object' && 'channel' in val) {
          registry.set(`${moduleKey}::${name}`, val as AnyRoomDef);
        }
      }
    }
  }
  return registry;
}

/** The minimal raw-WS surface the room runtime drives. */
interface RawWs {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * Build the WSEvents for a room connection. Called by `socketsHandler` after
 * the shared guard chain has run (so `denied` is already resolved); the socket
 * handler stays a thin "if room def, delegate" branch and all the room fan-out
 * lives here.
 *
 * Fan-out rules (the correctness core of the PR):
 *  - Every member subscribes to the room topic on the in-process bus, which
 *    delivers the published envelope OBJECT by reference (no serialization).
 *  - A 'msg' broadcast is published to the topic; the subscribe callback
 *    UNCONDITIONALLY skips the sender's own 'msg' echoes (sender-exclude), so a
 *    plain `broadcast` reaches everyone except the sender.
 *  - `broadcast(msg, { self: true })` additionally does a direct LOCAL send to
 *    the sender (no wire flag on the envelope).
 *  - Presence deltas (join/update/leave) are ALWAYS forwarded by every
 *    callback, including the sender's own; the client dedupes by member id.
 *  - The initial snapshot is sent DIRECTLY to the joining socket, never
 *    published (other members must not re-receive the whole roster).
 */
export function createRoomWsEvents(
  roomDef: AnyRoomDef,
  args: { ctx: Context; denied: boolean }
): WSEvents {
  const { ctx, denied } = args;

  // Wrap the raw WS so a send JSON-stringifies once to the client (the wire
  // encoding). Server->client envelopes ride this single stringify; the
  // client-side decodeEnvelope (Task 6) is the matching parse.
  const makeSocket = (ws: RawWs) => ({
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    close: (code?: number, reason?: string) => ws.close(code, reason),
  });

  // Per-connection state populated in onOpen and read by onMessage/onClose.
  let connId: string | undefined;
  let topic: string | undefined;
  let conn: RoomConnection<unknown, unknown, unknown> | undefined;
  let unsub: (() => void) | undefined;
  let joinTeardown: (() => void) | void;

  return {
    async onOpen(_e, rawWs) {
      const ws = makeSocket(rawWs as RawWs);
      if (denied) {
        ws.close(WS_DENY_CODE, 'forbidden');
        return;
      }

      // 1. The client sends key params as `r=<JSON>` (or omits `r` for a
      //    param-less channel). Parse the params from the untrusted wire boundary.
      const rawR = ctx.req.query(SOCKET_ROOM_PARAM);
      let params: Record<string, string> = {};
      if (rawR !== undefined && rawR !== '') {
        try {
          // Sanctioned untrusted-wire JSON.parse: the client sends the channel
          // key params as a JSON object; values are strings (channel param slots).
          const parsed: unknown = JSON.parse(rawR);
          // `JSON.parse('null')` succeeds but returns null, and `null["key"]`
          // throws a TypeError. Coerce any non-plain-object result to {} so the
          // required-param validation below denies cleanly via WS_DENY_CODE
          // instead of throwing. Numbers, strings, and arrays also fall to {}.
          params =
            parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
              ? (parsed as Record<string, string>) // sanctioned: untrusted wire JSON boundary
              : {};
        } catch {
          ws.close(WS_DENY_CODE, 'invalid room params');
          return;
        }
      }

      // 2. Compute the topic SERVER-SIDE by interpolating the channel name with
      //    the client-supplied params. The client can only vary param VALUES, not
      //    the namespace. This prevents cross-topic injection.
      //    The erased Channel<string,unknown> type resolves key() to zero args,
      //    but the runtime impl is interpolatePattern(name, params ?? {}), which
      //    accepts a params record. The cast reads the concrete runtime signature.
      topic = (roomDef.channel.key as (p?: Record<string, string>) => string)(
        params
      );

      // 3. Validate that all required `:param` segments in the channel name have
      //    a non-empty value in params. interpolatePattern drops missing segments
      //    rather than leaving `:name` in place, so we check the params object
      //    directly: every required (non-optional) param name from the channel
      //    name pattern must appear as a non-empty string in the parsed params.
      const missingRequired = roomDef.channel.name
        .split('/')
        .filter((seg) => {
          if (!seg.startsWith(':')) return false;
          const flag = seg[seg.length - 1];
          // Optional (?), rest-zero-or-more (*), and rest-one-or-more (+) are
          // not required to be present. Only plain `:name` is required.
          return flag !== '?' && flag !== '*' && flag !== '+';
        })
        .some((seg) => {
          const name = seg.slice(1);
          return !params[name];
        });
      if (!topic || missingRequired) {
        ws.close(WS_DENY_CODE, 'missing required room param');
        return;
      }

      // 4. Stable member id.
      connId = crypto.randomUUID();

      // 5. Subscribe to the topic. The bus delivers the envelope OBJECT by
      //    reference; narrowing `unknown` -> RoomEnvelope here is sanctioned:
      //    the room layer is the sole publisher/subscriber on its own topics,
      //    so we read our own object back through the unknown-typed seam (no
      //    decodeEnvelope; that is the client-side wire parse).
      const myId = connId;
      const mySocket = ws;
      unsub = getPubSubBackend().subscribe(topic, (message) => {
        const env = message as AnyEnvelope; // sanctioned: own object through the unknown seam
        // Sender-exclude: never echo my own 'msg' broadcasts back to me.
        if (env.t === 'msg' && env.from === myId) return;
        // Presence deltas (and others' msgs) are always forwarded.
        mySocket.send(env);
      });

      // 6. Seed presence with the server default (may be undefined) and join.
      const initialState = roomDef.presence?.();
      joinRoom(topic, connId, initialState);

      // 7. Send the joining socket the full roster snapshot DIRECTLY (not via
      //    publish: other members must not re-receive the whole roster).
      const snapshot: AnyEnvelope = {
        t: 'snapshot',
        members: roomMembers(topic),
      };
      ws.send(snapshot);

      // 8. Announce the join to the topic. The sender's own callback also
      //    forwards this (presence is always forwarded); the client dedupes by
      //    member id, so a self-echoed join is harmless.
      publishPresence(topic, connId, 'join', initialState);

      // 9. Build the RoomConnection handed to the user handlers.
      conn = {
        id: connId,
        data: {},
        close: (code, reason) => ws.close(code, reason),
        // Send to THIS connection only.
        send: (msg) => ws.send(envMsg(myId, msg)),
        // Broadcast to others (sender-excluded by the subscribe callback);
        // `{ self: true }` also does a direct local send to the sender.
        broadcast: (msg, opts) => {
          getPubSubBackend().publish(topic!, envMsg(myId, msg));
          if (opts?.self) ws.send(envMsg(myId, msg));
        },
        // Update + announce presence (same effect as a client 'presence' frame).
        setPresence: (state) => {
          updatePresence(topic!, myId, state);
          publishPresence(topic!, myId, 'update', state);
        },
      };

      // 10. Run the user's join hook; capture any teardown it returns.
      joinTeardown = await roomDef.onJoin?.(conn, { c: ctx, params });
    },

    async onMessage(ev, _ws) {
      if (denied || !conn || !topic || !connId) return;
      const raw =
        typeof ev.data === 'string'
          ? ev.data
          : ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : await (ev.data as Blob).text();
      const frame = JSON.parse(raw) as AnyFrame; // sanctioned untrusted-JSON boundary
      if (frame.t === 'presence') {
        // Framework-handled presence update (does NOT go through onMessage):
        // same effect as conn.setPresence(state).
        updatePresence(topic, connId, frame.state);
        publishPresence(topic, connId, 'update', frame.state);
        return;
      }
      // An application message: hand the inner payload to the user handler.
      await roomDef.onMessage?.(conn, frame.msg);
    },

    onClose() {
      if (!topic || !connId) return;
      // 10. Leave the roster, announce the leave, tear down the subscription
      //     and the user's onJoin teardown, then call onLeave.
      leaveRoom(topic, connId);
      publishPresence(topic, connId, 'leave', undefined);
      unsub?.();
      joinTeardown?.();
      if (conn) roomDef.onLeave?.(conn);
    },

    onError(ev) {
      if (!conn) return;
      // Unwrap the real error if the event carries one (ErrorEvent shape);
      // fall back to the event itself so no information is discarded. Mirrors
      // the socket handler's error unwrap.
      const err = ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
      roomDef.onError?.(conn, err);
    },
  };
}

/** Build a 'msg' envelope from a sender id and an application message. */
function envMsg(from: string, msg: unknown): AnyEnvelope {
  return { from, t: 'msg', msg };
}

/** Publish a presence delta to the topic. */
function publishPresence(
  topic: string,
  from: string,
  op: 'join' | 'update' | 'leave',
  state: unknown
): void {
  const env: AnyEnvelope = { from, t: 'presence', op, state };
  getPubSubBackend().publish(topic, env);
}
