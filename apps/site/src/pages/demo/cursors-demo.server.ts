import { defineChannel, serverRoute } from 'hono-preact';

type CursorMsg = { x: number; y: number };

// Channel name embeds the room key param so each named room gets its own
// Durable Object instance. On the docs site this fans out cursors across
// Worker isolates via the HONO_PREACT_REALTIME DO binding.
const cursorsChannel = defineChannel('cursors/:room')<CursorMsg>();

// Bind the room to its route. The binding stamps the route pattern on the
// room def, so boot validates it fail-closed against the module mount and
// the upgrade guard resolves this route's page-use chain (empty here: the
// cursors page is public) rather than deriving it from the module mount.
// The route has no :params, so the room/channel param-congruence check is
// trivially satisfied (the channel may be finer-grained than the route).
const route = serverRoute('/demo/cursors');

export const serverRooms = {
  cursors: route.room(cursorsChannel, {
    // Seed every joining member's presence with a default cursor position.
    presence: () => ({ x: 0, y: 0 }),
    // Relay cursor positions to all other members. Presence frames are handled
    // by the framework; only application messages arrive here.
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }),
};
