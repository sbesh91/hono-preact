import type { RoomTransport } from '../room-engine.js';

/**
 * The per-connection data blob stored via the DO hibernation API's
 * serializeAttachment / deserializeAttachment. It carries the fields the
 * room engine needs to reconstruct context across hibernation cycles.
 */
export interface RoomConnAttachment {
  connId: string;
  moduleKey: string;
  name: string;
  params: Record<string, string>;
  /** Edge-captured per-connection data bag (seeded at upgrade time). */
  data: unknown;
  /** The connection's current presence state (updated in place). */
  presence: unknown;
}

/**
 * The minimal slice of the DO connection store the CF transport needs.
 *
 * The real Durable Object provides this from `ctx.getWebSockets()` +
 * `deserializeAttachment` / `serializeAttachment`. A plain in-memory fake
 * provides this in unit tests, keeping the transport off the workerd API.
 */
export interface DOConnState {
  /** All currently live connections in this DO. */
  all(): Array<{
    id: string;
    send(data: string): void;
    getState(): RoomConnAttachment;
  }>;
  /**
   * Look up a single connection by its stable connId. Returns undefined if the
   * socket has already closed and been removed from the hibernation store.
   */
  get(connId: string):
    | {
        send(data: string): void;
        getState(): RoomConnAttachment;
        setState(s: RoomConnAttachment): void;
      }
    | undefined;
}

/**
 * Build a `RoomTransport` backed by the Durable Object hibernation connection
 * store.
 *
 * This file contains NO workerd / @cloudflare/workers-types imports. All
 * platform-specific code lives in the DOConnState adapter the real DO provides
 * (Task 5). The transport itself is pure TypeScript and is fully testable in
 * plain vitest with a fake DOConnState.
 *
 * Fan-out semantics:
 *   sendTo   - route a single envelope to one connection (no-op if gone).
 *   broadcast - send to all live connections, skipping the excluded id.
 *   roster   - snapshot of all live connections' presence states.
 *   joinPresence / updatePresence - write the presence field on the attachment.
 *   leavePresence - intentional no-op: closing the WebSocket removes it from
 *                   ctx.getWebSockets(), so the departed socket disappears from
 *                   store.all() automatically. No state write needed.
 *   data     - read the edge-captured data bag from the attachment.
 */
export function makeCfRoomTransport(
  connId: string,
  store: DOConnState
): RoomTransport {
  return {
    connId,

    sendTo(id, env) {
      store.get(id)?.send(JSON.stringify(env));
    },

    broadcast(env, excludeConnId) {
      for (const c of store.all()) {
        if (c.id !== excludeConnId) {
          c.send(JSON.stringify(env));
        }
      }
    },

    roster() {
      return store
        .all()
        .map((c) => ({ id: c.id, state: c.getState().presence }));
    },

    joinPresence(id, state) {
      const entry = store.get(id);
      if (entry) {
        entry.setState({ ...entry.getState(), presence: state });
      }
    },

    updatePresence(id, state) {
      const entry = store.get(id);
      if (entry) {
        entry.setState({ ...entry.getState(), presence: state });
      }
    },

    // leavePresence is intentionally a no-op for the CF transport.
    //
    // When a WebSocket closes in a Durable Object using the hibernation API,
    // the runtime removes it from ctx.getWebSockets() before calling the
    // webSocketClose / webSocketError handler. That means store.all() never
    // returns the departed socket, so there is nothing to clean up here.
    // Writing to its attachment at this point would be a wasted serialization
    // call on a socket the runtime has already evicted.
    leavePresence(_id) {
      // intentional no-op; see comment above
    },

    data(id) {
      return store.get(id)?.getState().data;
    },
  };
}
