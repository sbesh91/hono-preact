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

// Re-export so the DO and the door can pull the transport bits from one place.
export { makeCfRoomTransport };
export type { DOConnState, RoomConnAttachment };

/** Connections whose forwarded context exceeds this byte budget are denied. */
export const MAX_FORWARD_HEADER_BYTES = 6 * 1024;

// ---------------------------------------------------------------------------
// The worker-side forward connector
// ---------------------------------------------------------------------------

/**
 * Build the realtime connector the Cloudflare adapter installs. It handles BOTH
 * room dispositions socketsHandler routes to it:
 *
 *   - `forward`: an allowed, key-resolved room. The upgrade is forwarded to the
 *     topic's Durable Object (`idFromName(topic)`, so one DO per topic), passing
 *     the resolved room context as `x-hp-*` headers.
 *   - `deny`: a denied / key-failed room. The connector performs a workerd-native
 *     upgrade-and-close: it accepts the handshake and immediately closes the
 *     client socket with WS_DENY_CODE (4403), the documented deny contract. This
 *     happens entirely in the worker via `WebSocketPair`; the DO is NEVER
 *     contacted, so a denied connection cannot reach the room runtime.
 *
 * The forward path runs at the edge AFTER the guard chain has allowed the upgrade
 * and AFTER `roomDef.data?.(c)` has run (its result arrives as `data`), so the
 * DO never sees an unauthorized connection and never needs a live Context.
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
    const dataJson = JSON.stringify(data ?? null);
    const overBudget =
      byteLength(paramsJson) > MAX_FORWARD_HEADER_BYTES ||
      byteLength(dataJson) > MAX_FORWARD_HEADER_BYTES;
    if (overBudget) {
      throw new Error(
        'hono-preact: room connection context (params/data) exceeds the ' +
          `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. Keep the room data ` +
          'factory result small (it rides a request header to the Durable Object).'
      );
    }

    const stub = ns.get(ns.idFromName(topic));

    // Rebuild the request with a cloned, mutable Headers (inbound headers are
    // immutable in workerd). The body/method/upgrade intent carry over from the
    // original request so `stub.fetch` performs the WebSocket upgrade in the DO.
    const fwd = new Request(c.req.raw, {
      headers: new Headers(c.req.raw.headers),
    });
    fwd.headers.set('x-hp-topic', topic);
    fwd.headers.set('x-hp-module', moduleKey);
    fwd.headers.set('x-hp-name', name);
    fwd.headers.set('x-hp-params', paramsJson);
    fwd.headers.set('x-hp-data', dataJson);
    // The forward connector handles ONLY room upgrades; the DO's pub/sub topic and
    // publish kinds are invoked separately by makeCfPubSubBackend, never here. Strip
    // any client-supplied x-hp-kind so a room-authorized client cannot smuggle a
    // header to divert its upgrade into the topic/publish branch on the room's DO.
    // The server, not the client, controls DO dispatch (the DO defaults absent to
    // 'room').
    fwd.headers.delete('x-hp-kind');

    // `stub.fetch` returns `Promise<Response>` (the forwarded 101 upgrade); the
    // connector returns it directly. socketsHandler returns this Response as-is.
    return stub.fetch(fwd);
  };
}

/** UTF-8 byte length of a string (header size is measured in bytes, not chars). */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
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

  return {
    all() {
      return sockets.map((ws) => ({
        id: attachmentOf(ws).connId,
        send: (data: string) => ws.send(data),
        getState: () => attachmentOf(ws),
      }));
    },
    get(connId) {
      const ws = sockets.find((s) => attachmentOf(s).connId === connId);
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
export function isTopicSubscriber(attachment: unknown): boolean {
  return (
    typeof attachment === 'object' &&
    attachment !== null &&
    (attachment as { kind?: unknown }).kind === 'topic'
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
