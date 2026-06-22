import { defineChannel, defineRoom } from 'hono-preact';

type CursorMsg = { x: number; y: number };

// Channel name embeds the room key param so each named room is a separate topic.
export const cursorsChannel = defineChannel('cursors/:room')<CursorMsg>();

// Each `serverRooms` entry is discovered by buildRoomRegistry via the module's
// `__moduleKey` (threaded by the Vite plugin) and the property name.
export const serverRooms = {
  cursors: defineRoom(cursorsChannel, {
    // Seed every joining member's presence with a default cursor position.
    presence: () => ({ x: 0, y: 0 }),
    // Relay application messages to all other members. The framework handles
    // client presence frames directly; they never arrive here.
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
};
