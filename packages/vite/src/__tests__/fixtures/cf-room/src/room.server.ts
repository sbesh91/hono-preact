import { defineChannel, defineRoom } from 'hono-preact';

type RoomMsg = { x: number };

// A single keyed channel so each `:id` is a distinct topic (one DO per topic).
// Kept module-local (not exported): a `.server` file may only export the
// recognized `server*` maps, and the channel only needs to be referenced by
// defineRoom in this module. The client gets the module key + room name from
// the build-injected stub, not the channel object.
const roomChannel = defineChannel('room/:id')<RoomMsg>();

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
};
