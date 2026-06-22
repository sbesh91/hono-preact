import { defineChannel, defineRoom } from 'hono-preact';

type CursorMsg = { x: number; y: number };

// Channel name embeds the room key param so each named room gets its own
// Durable Object instance. On the docs site this fans out cursors across
// Worker isolates via the HONO_PREACT_REALTIME DO binding.
const cursorsChannel = defineChannel('cursors/:room')<CursorMsg>();

export const serverRooms = {
  cursors: defineRoom(cursorsChannel, {
    // Seed every joining member's presence with a default cursor position.
    presence: () => ({ x: 0, y: 0 }),
    // Relay cursor positions to all other members. Presence frames are handled
    // by the framework; only application messages arrive here.
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
};
