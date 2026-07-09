/// <reference types="@cloudflare/workers-types/latest" />
//
// The platform-free half of the Durable Object runtime: the worker-side forward
// connector and the DOConnState adapter. It uses @cloudflare/workers-types ONLY
// for TYPES (WebSocket, DurableObjectNamespace), which are erased at runtime, so
// this module imports NO runtime workerd module (`cloudflare:workers` lives in
// the sibling `realtime-do.ts` with the class). That keeps these helpers
// importable and unit-testable in plain vitest (no workerd), which the class
// itself is not.

import type { Context } from 'hono';
import {
  makeCfRoomTransport,
  type DOConnState,
  type RoomConnAttachment,
} from './room-do-transport.js';
import {
  WS_DENY_CODE,
  type RealtimeConnector,
} from '@hono-preact/iso/internal/runtime';
import { MAX_FORWARD_HEADER_BYTES, byteLength } from '../realtime-budget.js';

// Re-export so the DO and the door can pull the transport bits from one place.
export { makeCfRoomTransport };
export type { DOConnState, RoomConnAttachment };
export { makeServerSocketHandle } from '../server-socket-handle.js';
export { MAX_FORWARD_HEADER_BYTES, byteLength };

// DO id namespace prefixes that keep rooms and pub/sub topics in DISJOINT
// Durable Object instances even when a channel key is reused across both:
// idFromName(ROOM_DO_PREFIX + key) for a room vs idFromName(TOPIC_DO_PREFIX +
// key) for a live-loader topic/publish. Without this, a reused key would
// co-locate a room and a topic in one DO (kind-filtered in makeDOConnState as a
// second line of defense, but kept structurally disjoint here).
export const ROOM_DO_PREFIX = 'room:';
export const TOPIC_DO_PREFIX = 'topic:';

/**
 * Drop every `x-hp-*` header from a forwarded request's cloned Headers before
 * the connector stamps its own. The `x-hp-*` namespace is server-controlled: it
 * carries DO dispatch (`x-hp-kind`), identity/context (`x-hp-data`,
 * `x-hp-params`), and routing (`x-hp-topic`/`x-hp-module`/`x-hp-name`). A client
 * cannot be allowed to smuggle any of them through -- most critically
 * `x-hp-data`, which the DO surfaces verbatim as `conn.data`/`socket.data`, the
 * documented carrier for server-established identity. Stamping a value is not
 * enough on its own: a factory that returns `undefined` skips its `set()`, so
 * without this strip the client's own header would survive. Clearing the whole
 * namespace up front makes the server's subsequent `set()`s the sole source.
 */
function stripForwardedHpHeaders(headers: Headers): void {
  for (const key of [...headers.keys()]) {
    if (key.toLowerCase().startsWith('x-hp-')) headers.delete(key);
  }
}

// ---------------------------------------------------------------------------
// The worker-side forward connector
// ---------------------------------------------------------------------------

/**
 * Build the realtime connector the Cloudflare adapter installs. It handles room
 * and socket dispositions socketsHandler routes to it:
 *
 *   - `forward`: an allowed, key-resolved room. The upgrade is forwarded to the
 *     topic's Durable Object (`idFromName(topic)`, so one DO per topic), passing
 *     the resolved room context as `x-hp-*` headers.
 *   - `socket-forward`: an allowed socket. Forwarded to a fresh per-connection DO
 *     (ns.newUniqueId) with x-hp-kind: socket so the DO routes to the socket handler.
 *   - `deny`: a denied / key-failed room or socket. The connector performs a
 *     workerd-native upgrade-and-close: it accepts the handshake and immediately
 *     closes the client socket with WS_DENY_CODE (4403), the documented deny
 *     contract. This happens entirely in the worker via `WebSocketPair`; the DO
 *     is NEVER contacted, so a denied connection cannot reach the runtime.
 *
 * The forward path runs at the edge AFTER the guard chain has allowed the upgrade
 * and AFTER `roomDef.data?.(c)` or `socketDef.data?.(c)` has run (its result
 * arrives as `data`), so the DO never sees an unauthorized connection and never
 * needs a live Context.
 *
 * Inbound `Request.headers` are immutable in workerd, so the forwarded request
 * is rebuilt from `c.req.raw` with a cloned `Headers` (the spike-confirmed
 * shape) before the `x-hp-*` headers are stamped on.
 *
 * @param getNamespace reads the DO binding off the request context (the adapter
 *   passes `(c) => c.env[<realtimeBinding>]`, by default
 *   `(c) => c.env.HONO_PREACT_REALTIME`). Returns undefined when the binding is
 *   missing, which is a clear configuration error.
 * @param bindingName the configured binding name, used only to name the binding
 *   in the missing-binding error so it points at the developer's actual env key.
 */
export function makeCfForwardConnector(
  getNamespace: (c: Context) => DurableObjectNamespace | undefined,
  bindingName = 'HONO_PREACT_REALTIME'
): RealtimeConnector {
  return async (ctx) => {
    // Deny / key-fail: close the handshake WS_DENY_CODE without contacting the
    // DO. A denied connection never reaches the room runtime (the security
    // invariant). `WebSocketPair` is a workerd global; this seam is the only
    // place that close can run, since socketsHandler is platform-neutral and
    // cannot import workerd APIs.
    if (ctx.kind === 'deny') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      server.close(WS_DENY_CODE, 'forbidden');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (ctx.kind === 'socket-forward') {
      const { c, moduleKey, name, data } = ctx;
      const ns = getNamespace(c);
      if (!ns) {
        throw new Error(
          `hono-preact: sockets on Cloudflare require the ${bindingName} ` +
            'Durable Object binding. Add it to wrangler.jsonc (see the WebSockets docs).'
        );
      }
      // Only serialize when a data factory ran. Leaving x-hp-data ABSENT for a
      // factory-less socket lets the DO resolve socket.data to `undefined`
      // (Node parity), while an intentional `null` factory result rides as the
      // string 'null'. Stamping `?? null` unconditionally would make a
      // factory-less socket see `null` on CF but `undefined` on Node.
      const dataJson = data === undefined ? undefined : JSON.stringify(data);
      if (
        dataJson !== undefined &&
        byteLength(dataJson) > MAX_FORWARD_HEADER_BYTES
      ) {
        throw new Error(
          'hono-preact: socket connection data exceeds the ' +
            `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. Keep the socket data ` +
            'factory result small (it rides a request header to the Durable Object).'
        );
      }
      // A plain socket has no topic identity; mint a fresh DO per connection.
      const stub = ns.get(ns.newUniqueId());
      const fwd = new Request(c.req.raw, {
        headers: new Headers(c.req.raw.headers),
      });
      // Clear the server-controlled x-hp-* namespace before stamping, so no
      // client-supplied x-hp-kind (DO dispatch) or x-hp-data (socket.data
      // identity) can survive -- x-hp-data is conditional below, so an absent
      // data factory would otherwise leave the client's header in place.
      stripForwardedHpHeaders(fwd.headers);
      fwd.headers.set('x-hp-kind', 'socket');
      fwd.headers.set('x-hp-module', moduleKey);
      fwd.headers.set('x-hp-name', name);
      if (dataJson !== undefined) fwd.headers.set('x-hp-data', dataJson);
      return stub.fetch(fwd);
    }

    const { c, topic, moduleKey, name, params, data } = ctx;
    const ns = getNamespace(c);
    if (!ns) {
      throw new Error(
        `hono-preact: rooms on Cloudflare require the ${bindingName} ` +
          'Durable Object binding. Add it to wrangler.jsonc (see the rooms docs).'
      );
    }

    // Serialize the per-connection context onto forwarded headers. params/data
    // are user/edge-derived JSON; bound their size so an oversized data bag (or
    // a hostile params payload) cannot blow the DO's request header budget.
    const paramsJson = JSON.stringify(params);
    // Only serialize when a data factory ran. An ABSENT x-hp-data lets the DO
    // resolve conn.data to `undefined` (parity with Node and with the socket
    // branch); an intentional `null` result rides as the string 'null'.
    const dataJson = data === undefined ? undefined : JSON.stringify(data);
    const overBudget =
      byteLength(paramsJson) > MAX_FORWARD_HEADER_BYTES ||
      (dataJson !== undefined &&
        byteLength(dataJson) > MAX_FORWARD_HEADER_BYTES);
    if (overBudget) {
      throw new Error(
        'hono-preact: room connection context (params/data) exceeds the ' +
          `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. Keep the room data ` +
          'factory result small (it rides a request header to the Durable Object).'
      );
    }

    const stub = ns.get(ns.idFromName(ROOM_DO_PREFIX + topic));

    // Rebuild the request with a cloned, mutable Headers (inbound headers are
    // immutable in workerd). The body/method/upgrade intent carry over from the
    // original request so `stub.fetch` performs the WebSocket upgrade in the DO.
    const fwd = new Request(c.req.raw, {
      headers: new Headers(c.req.raw.headers),
    });
    // Clear the server-controlled x-hp-* namespace before stamping. This strips
    // any client-supplied x-hp-kind (so a room-authorized client cannot divert
    // its upgrade into the topic/publish branch on the room's DO; the DO defaults
    // an absent kind to 'room') and any client-supplied x-hp-data (conn.data
    // identity), which is conditional below and would otherwise survive when the
    // room has no data factory. The server, not the client, controls dispatch.
    stripForwardedHpHeaders(fwd.headers);
    fwd.headers.set('x-hp-topic', topic);
    fwd.headers.set('x-hp-module', moduleKey);
    fwd.headers.set('x-hp-name', name);
    fwd.headers.set('x-hp-params', paramsJson);
    if (dataJson !== undefined) fwd.headers.set('x-hp-data', dataJson);

    // `stub.fetch` returns `Promise<Response>` (the forwarded 101 upgrade); the
    // connector returns it directly. socketsHandler returns this Response as-is.
    return stub.fetch(fwd);
  };
}

// ---------------------------------------------------------------------------
// DOConnState adapter over the hibernation API
// ---------------------------------------------------------------------------

/**
 * Build the `DOConnState` the CF transport consumes from a list of hibernation
 * WebSockets. Each socket carries its `RoomConnAttachment` via
 * (de)serializeAttachment; the connId is read from the attachment so the store
 * can index by the stable member id (NOT by socket identity, which is opaque).
 *
 * Exported so the per-event logic is testable in plain vitest with a fake
 * `getWebSockets()`-shaped array, without workerd. `all()` and `get()` read the
 * attachment lazily on each call so a `setState` write is visible to a later
 * read within the same event.
 */
export function makeDOConnState(sockets: WebSocket[]): DOConnState {
  const attachmentOf = (ws: WebSocket): RoomConnAttachment =>
    // Sanctioned cast: deserializeAttachment() returns `any` (untrusted-shaped
    // hibernation payload). We wrote it ourselves as a RoomConnAttachment in
    // the DO's fetch(); read it back at that one boundary.
    ws.deserializeAttachment() as RoomConnAttachment;

  // A DO instance can host more than room connections: a reused channel key can
  // co-locate live-loader topic subscribers ({ kind: 'topic' }) or plain
  // sockets ({ kind: 'socket' }) on the same DO. The room store must view ONLY
  // room connections, or a non-room socket surfaces as a phantom
  // { id: undefined } roster member and receives leaked room broadcasts. Kind
  // is immutable for a connection's lifetime, so filter once at construction.
  const roomSockets = sockets.filter((ws) => {
    const att: unknown = ws.deserializeAttachment();
    return !isTopicSubscriber(att) && !isSocketConnection(att);
  });

  return {
    all() {
      return roomSockets.map((ws) => ({
        id: attachmentOf(ws).connId,
        send: (data: string) => ws.send(data),
        getState: () => attachmentOf(ws),
      }));
    },
    get(connId) {
      const ws = roomSockets.find((s) => attachmentOf(s).connId === connId);
      if (!ws) return undefined;
      return {
        send: (data: string) => ws.send(data),
        getState: () => attachmentOf(ws),
        setState: (s: RoomConnAttachment) => ws.serializeAttachment(s),
      };
    },
  };
}

/**
 * True when a hibernation socket's attachment marks it as a live-loader topic
 * subscriber (`{ kind: 'topic' }`), as opposed to a room connection (whose
 * attachment is a RoomConnAttachment with no `kind`). Topic subscribers are
 * receive-only and never run the room engine.
 */
export function isTopicSubscriber(
  attachment: unknown
): attachment is { kind: 'topic' } {
  return (
    typeof attachment === 'object' &&
    attachment !== null &&
    (attachment as { kind?: unknown }).kind === 'topic'
  );
}

/**
 * The per-connection attachment for a plain duplex socket on Cloudflare. Unlike
 * a room (RoomConnAttachment) it has no presence/params; unlike a topic
 * subscriber ({ kind: 'topic' }) it runs the socket handler. Carried via
 * serializeAttachment so the message/close/error handlers rebuild context
 * across hibernation cycles.
 */
export interface SocketConnAttachment {
  kind: 'socket';
  moduleKey: string;
  name: string;
  data: unknown;
}

/** True when a hibernation socket's attachment marks it as a plain duplex socket. */
export function isSocketConnection(
  attachment: unknown
): attachment is SocketConnAttachment {
  return (
    typeof attachment === 'object' &&
    attachment !== null &&
    (attachment as { kind?: unknown }).kind === 'socket'
  );
}

/**
 * Fan a published frame out to a topic's subscriber sockets. Each send is
 * isolated: a single stale or closing socket throwing on `send` (a routine
 * outcome on workerd after a hibernation cycle or peer eviction) must not drop
 * the message for the remaining subscribers. This mirrors the in-process
 * backend, which wraps each subscriber so "one throwing listener does not
 * starve the rest." Exported so the fan-out is unit-testable without workerd.
 */
export function fanOutToTopicSubscribers(
  sockets: Iterable<WebSocket>,
  body: string
): void {
  for (const ws of sockets) {
    try {
      ws.send(body);
    } catch (err) {
      console.error('hono-preact: pub/sub fan-out send failed', err);
    }
  }
}

/**
 * The socket list a close/error handler builds its store from. workerd evicts
 * the closing socket from `getWebSockets()` before `webSocketClose` runs, so
 * re-include it (Node parity: `onLeave`/`onError` still resolve the leaver's
 * `data` off its attachment, and the leaver appears in the roster). The
 * `includes` guard avoids listing it twice (on an error it is usually still
 * live), so a broadcast never double-sends to it.
 *
 * Pure helper, generic over the socket type, so the re-inclusion decision is
 * unit-testable without workerd (the DO's `#storeWith` just calls it).
 */
export function socketsForCloseEvent<S>(live: S[], ws: S): S[] {
  return live.includes(ws) ? live : [...live, ws];
}

/** Parse an `x-hp-*` JSON header; missing or malformed yields `null`. */
export function parseHeaderJson(raw: string | null): unknown {
  if (raw === null || raw === '') return null;
  try {
    // Sanctioned untrusted-wire JSON.parse: the value was stamped by the forward
    // connector but reaches the DO over the request, so parse defensively.
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
