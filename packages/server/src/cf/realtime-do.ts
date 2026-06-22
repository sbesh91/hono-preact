/// <reference types="@cloudflare/workers-types/latest" />
//
// The ONE server file that imports a RUNTIME workerd module (`cloudflare:workers`,
// for the Durable Object base class). It is the thin hibernation glue: it adapts
// the DO WebSocket Hibernation API to the shared room engine. Everything
// platform-free (the forward connector, the DOConnState adapter, header
// parsing) lives in `realtime-do-glue.ts` so it stays unit-testable in plain
// vitest; this file is only importable in workerd.

import { DurableObject } from 'cloudflare:workers';
import type { RoomDef } from '@hono-preact/iso/internal';
import {
  engineJoin,
  engineMessage,
  engineClose,
  makeRoomConnection,
} from '../room-engine.js';
import type { RoomConnAttachment } from './room-do-transport.js';
import {
  makeCfRoomTransport,
  makeDOConnState,
  parseHeaderJson,
} from './realtime-do-glue.js';
import type { DOConnState } from './realtime-do-glue.js';
import { getRoomRegistry } from './room-registry.js';

// Re-export the platform-free helpers so the CF door can pull everything from
// the DO module.
export {
  makeCfForwardConnector,
  makeDOConnState,
  MAX_FORWARD_HEADER_BYTES,
} from './realtime-do-glue.js';

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;

// ---------------------------------------------------------------------------
// The Durable Object
// ---------------------------------------------------------------------------

/**
 * One hibernating Durable Object per room topic. The worker forwards an
 * already-guarded room upgrade here (`idFromName(topic)`); this DO owns the room
 * runtime for that topic: it accepts the socket for hibernation, drives the
 * shared room engine on join/message/close, and fans out intra-DO over its own
 * `ctx.getWebSockets()` (no pub/sub; that is PR 5b).
 *
 * State lives on per-socket attachments (serializeAttachment), so the DO holds
 * no in-memory connection map and survives hibernation cycles: every handler
 * rebuilds the transport from `ctx.getWebSockets()` + attachments.
 *
 * onJoin TEARDOWN ON CLOUDFLARE: the function `onJoin` may return runs only on
 * Node. A teardown closure cannot survive a hibernation cycle, so it is NOT
 * captured or run here. `onLeave` is the portable leave hook on both runtimes;
 * webSocketClose calls it after engineClose. Put leave-side cleanup there.
 */
export class HonoPreactRealtimeDO extends DurableObject {
  /** Cached `${moduleKey}::${name}` -> RoomDef map (resolved on first use). */
  #registry: Map<string, AnyRoomDef> | undefined;

  /**
   * Resolve a room def by module key + room name from the installed registry.
   * The generated CF worker entry installs the getter at module top level; this
   * caches the resolved Map after the first lookup.
   */
  async getDef(moduleKey: string, name: string): Promise<AnyRoomDef> {
    if (!this.#registry) {
      const getter = getRoomRegistry();
      if (!getter) {
        throw new Error(
          'hono-preact: no room registry installed in the Durable Object. The ' +
            'generated Cloudflare worker entry must call installRoomRegistry() ' +
            'at module top level.'
        );
      }
      this.#registry = await getter();
    }
    const def = this.#registry.get(`${moduleKey}::${name}`);
    if (!def) {
      throw new Error(
        `hono-preact: no room registered for "${moduleKey}::${name}".`
      );
    }
    return def;
  }

  /** Build the DOConnState over this DO's live hibernation sockets. */
  #store(): DOConnState {
    return makeDOConnState(this.ctx.getWebSockets());
  }

  /**
   * Build the store for a close/error event INCLUDING the event's own socket.
   *
   * On a close, the runtime removes the closing socket from getWebSockets()
   * before this handler fires. The Node runtime, by contrast, runs engineClose
   * while the leaving connection is still live (its `unsub` runs after), so the
   * leaving conn still resolves its `data` bag in `onLeave`. To match that, the
   * close/error store re-includes the event socket so `conn.data` (read off the
   * attachment) is the real data bag in `onLeave`/`onError`, not undefined. The
   * `includes` guard avoids listing the socket twice (on an error it is usually
   * still in getWebSockets()), so a broadcast never double-sends to it.
   */
  #storeWith(ws: WebSocket): DOConnState {
    const live = this.ctx.getWebSockets();
    const sockets = live.includes(ws) ? live : [...live, ws];
    return makeDOConnState(sockets);
  }

  /**
   * Accept the forwarded upgrade: read the `x-hp-*` context, mint a connId,
   * accept the server socket for hibernation, seed its attachment, then run the
   * engine join sequence (presence join + snapshot + presence/join broadcast +
   * onJoin). Returns the 101 with the client socket.
   */
  async fetch(request: Request): Promise<Response> {
    const moduleKey = request.headers.get('x-hp-module') ?? '';
    const name = request.headers.get('x-hp-name') ?? '';
    // `x-hp-topic` is not re-read here: this DO instance IS the topic (the edge
    // routed to it via `idFromName(topic)`), and fan-out is intra-DO over
    // getWebSockets(), so the topic string is never needed inside the DO.
    // Sanctioned cast: x-hp-params is stamped server-side by the forward
    // connector but rides the wire, so it is parsed at the untrusted-JSON
    // boundary; it is a string-valued record. x-hp-data is the edge data bag.
    const params = parseHeaderJson(
      request.headers.get('x-hp-params')
    ) as Record<string, string>;
    const data = parseHeaderJson(request.headers.get('x-hp-data'));

    const def = await this.getDef(moduleKey, name);

    const connId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation accept (NOT server.accept()): the runtime persists the socket
    // and wakes the DO with webSocketMessage/Close/Error events later.
    this.ctx.acceptWebSocket(server);

    // Seed the attachment BEFORE running the engine: the transport reads the
    // roster (and this connection's presence) off attachments, and the joiner
    // must already be in getWebSockets() with its initial presence so the
    // snapshot it receives includes itself.
    // `presence` is left undefined here; engineJoin -> joinPresence writes the
    // real initial value (def.presence?.()) into the attachment via the CF
    // transport, so def.presence() is called exactly once per join (not twice).
    const attachment: RoomConnAttachment = {
      connId,
      moduleKey,
      name,
      params,
      data,
      presence: undefined,
    };
    server.serializeAttachment(attachment);

    const t = makeCfRoomTransport(connId, this.#store());
    await engineJoin(t, def, params, (code, reason) =>
      server.close(code, reason)
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Route an inbound client frame through the engine for the sending socket. */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    // Sanctioned cast: we wrote this attachment in fetch(); read it back at the
    // untrusted-shaped hibernation boundary.
    const att = ws.deserializeAttachment() as RoomConnAttachment;
    const def = await this.getDef(att.moduleKey, att.name);
    const t = makeCfRoomTransport(att.connId, this.#store());
    const raw =
      typeof message === 'string' ? message : new TextDecoder().decode(message);
    await engineMessage(t, def, raw, (code, reason) => ws.close(code, reason));
  }

  /** Run the engine leave sequence for the closing socket. */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as RoomConnAttachment;
    const def = await this.getDef(att.moduleKey, att.name);
    // engineClose does: leavePresence (a CF no-op; the socket is already
    // evicted from getWebSockets), broadcast presence/leave to the room.
    // The store re-includes the closing socket so the onLeave conn resolves
    // its `data` bag (Node parity); the closing socket receiving its own
    // leave echo is harmless (the client dedupes by member id, mid-teardown).
    // The DO has no unsub/joinTeardown (teardown closures cannot survive
    // hibernation), so onLeave runs immediately after engineClose, which
    // preserves the CF behavior (onLeave still runs after the leave broadcast).
    const closeWs = (code?: number, reason?: string) => ws.close(code, reason);
    const t = makeCfRoomTransport(att.connId, this.#storeWith(ws));
    engineClose(t, def, closeWs);
    const conn = makeRoomConnection(t, closeWs);
    def.onLeave?.(conn);
  }

  /** Hand a socket error to the room's onError hook. */
  async webSocketError(ws: WebSocket, err: unknown): Promise<void> {
    const att = ws.deserializeAttachment() as RoomConnAttachment;
    const def = await this.getDef(att.moduleKey, att.name);
    const t = makeCfRoomTransport(att.connId, this.#storeWith(ws));
    const conn = makeRoomConnection(t, (code, reason) =>
      ws.close(code, reason)
    );
    def.onError?.(conn, err);
  }
}
