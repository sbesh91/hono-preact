import {
  defineChannel,
  defineRoom,
  defineServerMiddleware,
  deny,
} from 'hono-preact';

type RoomMsg = { x: number };

// A single keyed channel so each `:id` is a distinct topic (one DO per topic).
// Kept module-local (not exported): a `.server` file may only export the
// recognized `server*` maps, and the channel only needs to be referenced by
// defineRoom in this module. The client gets the module key + room name from
// the build-injected stub, not the channel object.
const roomChannel = defineChannel('room/:id')<RoomMsg>();

// A second channel for the denied room (distinct topic space from the open one).
const deniedChannel = defineChannel('denied/:id')<RoomMsg>();

// A third channel for the factory-less probe room (distinct topic space).
type ProbeReply = { dataIsUndefined: boolean };
const probeChannel = defineChannel('probe/:id')<ProbeReply>();

// A guard that ALWAYS denies. This is the canonical auth-deny shape (the same
// `throw deny(...)` a `requireSession` gate uses). On Cloudflare the worker must
// close the connection WS_DENY_CODE (4403) WITHOUT contacting the Durable
// Object, NOT crash with a 500 (the bug this fixture's denied room guards).
const denyAll = defineServerMiddleware(async () => {
  throw deny('forbidden', 403);
});

// `serverRooms` is discovered by buildRoomRegistry via this module's
// auto-injected `__moduleKey` (the moduleKeyPlugin prepends it) and the
// property name below. The registry key is `${moduleKey}::room`.
export const serverRooms = {
  room: defineRoom(roomChannel, {
    // Seed each joining member's presence so the snapshot/roster carries state.
    presence: () => ({ x: 0 }),
    // Relay application messages to every OTHER member (sender-exclude is the
    // engine's job; broadcast skips the sender).
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
  // No `data` factory: conn.data must resolve to `undefined` on the Cloudflare
  // Durable Object (parity with Node, where a factory-less room defaults
  // conn.data to undefined). The DO reaches this via realtime-do's "x-hp-data
  // absent -> undefined" branch. onMessage replies to the SENDER (conn.send =
  // sendTo self) so a single connected client observes its own probe result.
  probe: defineRoom(probeChannel, {
    onMessage(conn) {
      conn.send({ dataIsUndefined: conn.data === undefined });
    },
  }),
  // A room whose guard denies every connection. The registry key is
  // `${moduleKey}::deniedRoom`. On Cloudflare a connection here must close 4403,
  // routed through the connector's transport-native deny close (no DO contact),
  // NOT crash the worker with a 500 (the pre-fix getWebSocketUpgrader() throw).
  deniedRoom: defineRoom(deniedChannel, {
    use: [denyAll],
    presence: () => ({ x: 0 }),
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
};
