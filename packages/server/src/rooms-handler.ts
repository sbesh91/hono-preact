import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  WS_DENY_CODE,
  getPubSubBackend,
  joinPresence,
  leavePresence,
  updatePresence,
  presenceMembers,
} from '@hono-preact/iso/internal/runtime';
import type { RoomDef, RoomEnvelope } from '@hono-preact/iso/internal';
import {
  engineJoin,
  engineMessage,
  engineClose,
  makeRoomConnection,
  type RoomTransport,
} from './room-engine.js';
import { warnIfOverForwardBudget } from './realtime-budget.js';

type GlobModule = {
  __moduleKey?: unknown;
  serverRooms?: unknown;
  [key: string]: unknown;
};
type LazyArray = ReadonlyArray<() => Promise<unknown>>;

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;
type AnyEnvelope = RoomEnvelope<unknown, unknown>;

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
 * handler stays a thin "if room def, delegate" branch.
 *
 * The room PROTOCOL (snapshot/deltas, fan-out rules, frame routing, the
 * join/message/leave sequence, the `RoomConnection` shape) lives in the
 * transport-agnostic engine (`room-engine.ts`). This function only builds a
 * NODE `RoomTransport` and delegates to the engine. The transport realizes each
 * engine primitive on the in-process pub/sub bus + the presence registry:
 *
 *  - `sendTo(connId, env)` is ALWAYS a send to this connection's own socket
 *    (the engine's only direct sends are self-targeted: the snapshot to the
 *    joiner, `conn.send`, and the `{ self: true }` broadcast copy). It
 *    JSON-stringifies once to the client (the wire encoding).
 *  - `broadcast(env, excludeConnId)` PUBLISHES to the room topic. The exclusion
 *    is NOT applied at publish time; instead each connection's own subscribe
 *    callback skips the sender's own `'msg'` echoes by `env.from`. So a plain
 *    `broadcast` reaches everyone except the sender (receiver-side exclude),
 *    and presence deltas reach everyone (the sender's self-echo is harmless;
 *    the client dedupes by member id). This is exactly the PR 4 fan-out: the
 *    engine still passes `excludeConnId` (the Cloudflare transport honors it
 *    directly), but the Node behavior is driven by the published `env.from` +
 *    the receiver-side skip.
 *  - presence ops map to the presence registry: `joinPresence`/`leavePresence`/
 *    `updatePresence` -> `joinPresence`/`leavePresence`/`updatePresence`, and
 *    `roster()` -> `presenceMembers(topic)`.
 *  - `data(connId)` returns the per-connection bag captured at the edge in
 *    onOpen (the `roomDef.data?.(ctx)` result seeding `conn.data`).
 */
export function createRoomWsEvents(
  roomDef: AnyRoomDef,
  args: {
    ctx: Context;
    denied: boolean;
    roomKey: RoomKeyResolution;
    dev: boolean;
  }
): WSEvents {
  const { ctx, denied, roomKey, dev } = args;

  // Per-connection state populated in onOpen and read by onMessage/onClose.
  let connId: string | undefined;
  let topic: string | undefined;
  let transport: RoomTransport | undefined;
  let unsub: (() => void) | undefined;
  let joinTeardown: (() => void) | void;
  // The connection's own socket close, captured in onOpen. `conn.close` (in
  // every engine handler) routes to it, so all handlers close the SAME socket
  // (as in PR 4, where the one `conn` carried `ws.close`).
  let closeConn: (code?: number, reason?: string) => void = () => {};

  return {
    async onOpen(_e, rawWs) {
      const ws = rawWs as RawWs;
      closeConn = (code, reason) => ws.close(code, reason);
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
      const roomTopic = roomKey.topic;
      const params = roomKey.params;
      topic = roomTopic;

      // Stable member id.
      const myId = crypto.randomUUID();
      connId = myId;

      // Subscribe to the topic. The bus delivers the envelope OBJECT by
      // reference; narrowing `unknown` -> RoomEnvelope here is sanctioned: the
      // room layer is the sole publisher/subscriber on its own topics, so we
      // read our own object back through the unknown-typed seam (no
      // decodeEnvelope; that is the client-side wire parse). Sender-exclude is
      // realized HERE, receiver-side: never echo my own 'msg' broadcasts back to
      // me. Presence deltas (and others' msgs) are always forwarded.
      unsub = getPubSubBackend().subscribe(roomTopic, (message) => {
        const env = message as AnyEnvelope; // sanctioned: own object through the unknown seam
        if (env.t === 'msg' && env.from === myId) return;
        ws.send(JSON.stringify(env));
      });

      // A factory-less room yields `undefined` (parity with sockets and with
      // Cloudflare, where an absent x-hp-data header resolves to undefined). An
      // intentional null/value factory result is honored verbatim. conn.data is
      // edge-seeded read-only metadata; use setPresence for evolving state.
      // Captured ONCE so the same bag reference is returned on
      // every `data(connId)` for the life of this Node process. That
      // single-reference behavior is a Node transport detail, NOT a cross-runtime
      // contract: on Cloudflare each event reads a freshly deserialized
      // attachment, so an in-place mutation to conn.data is not guaranteed to
      // persist across events.
      const initialData: unknown = await roomDef.data?.(ctx);
      warnIfOverForwardBudget(initialData, dev, 'room');

      // The Node transport: each engine primitive realized on the in-process bus
      // + the presence registry. `sendTo` is always this socket (the engine only
      // ever sends to self); `broadcast` publishes (exclusion is receiver-side,
      // above); presence ops hit the registry on this topic.
      transport = {
        connId: myId,
        sendTo: (_to, env) => ws.send(JSON.stringify(env)),
        broadcast: (env) => getPubSubBackend().publish(roomTopic, env),
        joinPresence: (id, state) => joinPresence(roomTopic, id, state),
        leavePresence: (id) => leavePresence(roomTopic, id),
        updatePresence: (id, state) => updatePresence(roomTopic, id, state),
        roster: () => presenceMembers(roomTopic),
        data: () => initialData,
      };

      // Drive the engine join sequence (presence join, snapshot, presence/join
      // broadcast, onJoin); capture the teardown onJoin returns.
      joinTeardown = await engineJoin(transport, roomDef, params, closeConn);
    },

    async onMessage(ev, _ws) {
      if (denied || !transport || !topic || !connId) return;
      const raw =
        typeof ev.data === 'string'
          ? ev.data
          : ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : await (ev.data as Blob).text();
      // The engine owns the try/catch JSON.parse + frame routing (presence /
      // msg / drop-unknown).
      await engineMessage(transport, roomDef, raw, closeConn);
    },

    onClose() {
      if (!transport || !topic || !connId) return;
      // Protocol: leave the roster + broadcast the presence/leave.
      engineClose(transport, roomDef, closeConn);
      // Tear down the subscription and the onJoin teardown BEFORE calling
      // onLeave, so the leave hook runs after all subscriptions are torn down
      // and after the onJoin teardown (restoring the pre-PR order).
      unsub?.();
      joinTeardown?.();
      // onLeave runs LAST: after unsub and the onJoin teardown, so the user
      // cannot inadvertently interact with a still-active subscription or a
      // timer started in onJoin that hasn't been cleaned up yet.
      const conn = makeRoomConnection(transport, closeConn);
      roomDef.onLeave?.(conn);
    },

    onError(ev) {
      if (!transport) return;
      // Unwrap the real error if the event carries one (ErrorEvent shape);
      // fall back to the event itself so no information is discarded. Mirrors
      // the socket handler's error unwrap. onError is not part of the engine
      // sequence; it builds a conn off the transport and calls the user hook.
      const err = ev && 'error' in ev ? (ev as { error: unknown }).error : ev;
      const conn = makeRoomConnection(transport, closeConn);
      roomDef.onError?.(conn, err);
    },
  };
}
