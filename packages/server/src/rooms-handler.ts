import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
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
 * The outcome of resolving a room connection's key params into a server-side
 * topic. On success the resolved `params` and the interpolated `topic` are
 * carried forward; the params double as the guard chain's `pathParams` (so a
 * route-node/room guard can read e.g. `ctx.location.pathParams.roomId`) AND the
 * `params` handed to `onJoin`. On any failure (bad JSON, a non-string param
 * value, a missing required `:param`) the connection is denied with
 * WS_DENY_CODE.
 */
export type RoomKeyResolution =
  | { ok: true; params: Record<string, string>; topic: string }
  | { ok: false };

/**
 * Parse + validate a room connection's key params from the untrusted wire and
 * compute the server-side topic, BEFORE the guard chain runs. Pure (no I/O, no
 * connection side effects) so the socket handler can resolve it once, feed the
 * resolved params into the guard as `pathParams`, and hand the result to
 * `createRoomWsEvents` without a re-parse.
 *
 * Security property preserved: the topic is ALWAYS `channel.key(params)`
 * computed here, server-side. The client only varies param VALUES, never the
 * channel namespace, so it cannot reach an unrelated topic.
 *
 * @param channel The room's bound channel (its name pattern + `key`).
 * @param rawR    The raw `SOCKET_ROOM_PARAM` query value (or undefined).
 */
export function resolveRoomKey(
  channel: AnyRoomDef['channel'],
  rawR: string | undefined
): RoomKeyResolution {
  // The client sends key params as `r=<JSON>` (or omits `r` for a param-less
  // channel). An absent/empty `r` means no params.
  let params: Record<string, string> = {};
  if (rawR !== undefined && rawR !== '') {
    let parsed: unknown;
    try {
      // Sanctioned untrusted-wire JSON.parse: the client sends the channel key
      // params as a JSON object whose values are strings (channel param slots).
      parsed = JSON.parse(rawR);
    } catch {
      return { ok: false };
    }
    // `JSON.parse('null')` succeeds but returns null, and `null["key"]` throws.
    // Coerce any non-plain-object parse result (null, numbers, strings, arrays)
    // to {} so the required-param check below denies cleanly. Then validate that
    // every value is a string: a non-string value (e.g. `{"roomId":[1,2,3]}`)
    // would otherwise arrive at the handler as a typed-contract lie, so reject
    // it here instead of casting a non-string-valued object to Record<string,string>.
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const entries = Object.entries(parsed);
      if (entries.some(([, v]) => typeof v !== 'string')) {
        return { ok: false };
      }
      // Every value is a string (checked above): this is now a sound narrowing,
      // not a cast over an unvalidated shape.
      params = Object.fromEntries(
        entries.filter((e): e is [string, string] => typeof e[1] === 'string')
      );
    }
  }

  // Compute the topic SERVER-SIDE by interpolating the channel name with the
  // client-supplied params. The erased Channel<string,unknown> type resolves
  // key() to zero args, but the runtime impl is interpolatePattern(name,
  // params ?? {}), which accepts a params record; this reads that concrete
  // runtime signature.
  const topic = (channel.key as (p?: Record<string, string>) => string)(params);

  // Validate that every required `:param` segment in the channel name has a
  // non-empty value. interpolatePattern drops a missing segment rather than
  // leaving `:name` in place, so we check the params object directly.
  const missingRequired = channel.name
    .split('/')
    .filter((seg) => {
      if (!seg.startsWith(':')) return false;
      const flag = seg[seg.length - 1];
      // Optional (?), rest-zero-or-more (*), and rest-one-or-more (+) are not
      // required to be present. Only plain `:name` is required.
      return flag !== '?' && flag !== '*' && flag !== '+';
    })
    .some((seg) => !params[seg.slice(1)]);

  if (!topic || missingRequired) {
    return { ok: false };
  }

  return { ok: true, params, topic };
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
  args: { ctx: Context; denied: boolean; roomKey: RoomKeyResolution }
): WSEvents {
  const { ctx, denied, roomKey } = args;

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
      // Deny BEFORE subscribe/join if the guard chain denied OR the room key
      // failed to resolve (bad JSON, a non-string param value, or a missing
      // required `:param`). The room key was parsed + validated server-side in
      // socketsHandler (resolveRoomKey) before the guard ran, so onOpen does not
      // re-parse; it consumes the pre-resolved topic/params directly.
      if (denied || !roomKey.ok) {
        ws.close(WS_DENY_CODE, 'forbidden');
        return;
      }

      // The server-computed topic (always channel.key(params)) and the validated
      // string-valued params. The client only varies param VALUES, never the
      // namespace, so it cannot reach an unrelated topic.
      topic = roomKey.topic;
      const params = roomKey.params;

      // 1. Stable member id.
      connId = crypto.randomUUID();

      // 2. Subscribe to the topic. The bus delivers the envelope OBJECT by
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

      // 3. Seed presence with the server default (may be undefined) and join.
      const initialState = roomDef.presence?.();
      joinRoom(topic, connId, initialState);

      // 4. Send the joining socket the full roster snapshot DIRECTLY (not via
      //    publish: other members must not re-receive the whole roster).
      const snapshot: AnyEnvelope = {
        t: 'snapshot',
        self: connId,
        members: roomMembers(topic),
      };
      ws.send(snapshot);

      // 5. Announce the join to the topic. The sender's own callback also
      //    forwards this (presence is always forwarded); the client dedupes by
      //    member id, so a self-echoed join is harmless.
      publishPresence(topic, connId, 'join', initialState);

      // 6. Build the RoomConnection handed to the user handlers.
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

      // 7. Run the user's join hook; capture any teardown it returns.
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
      let frame: AnyFrame;
      try {
        frame = JSON.parse(raw) as AnyFrame; // sanctioned untrusted-JSON boundary
      } catch {
        // A malformed (non-JSON) frame would otherwise reject this async handler
        // with an unhandled rejection. Drop it silently.
        return;
      }
      if (frame.t === 'presence') {
        // Framework-handled presence update (does NOT go through onMessage):
        // same effect as conn.setPresence(state).
        updatePresence(topic, connId, frame.state);
        publishPresence(topic, connId, 'update', frame.state);
        return;
      }
      if (frame.t === 'msg') {
        // An application message: hand the inner payload to the user handler.
        await roomDef.onMessage?.(conn, frame.msg);
        return;
      }
      // Unknown `t`: silently drop. Do NOT fall through to onMessage with an
      // undefined payload (the old implicit-else assumed `t === 'msg'`).
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
