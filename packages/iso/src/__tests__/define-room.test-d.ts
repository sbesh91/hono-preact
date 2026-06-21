// Type-contract test for the room definition surface. Run under
// `pnpm test:types`. A room is a `defineSocket`-shaped handler BOUND TO a typed
// `Channel` whose name pattern carries the room-key params. These probes pin:
//   - `onMessage(conn, msg)` infers `msg: Incoming`,
//   - `conn.send` / `conn.broadcast` accept the server->client `Outgoing` type,
//   - `conn.setPresence` accepts the `State` type,
//   - `ctx.params` in `onJoin` is the CHANNEL name's params (not the route's;
//     the room key rides the wire, so the channel is the only param source),
//   - and the same inference holds for bare `defineRoom(channel, handler)` and
//     for `route.room(channel, handler)`.
import { expectTypeOf } from 'vitest';
import { defineRoom } from '../define-room.js';
import { defineChannel } from '../define-channel.js';
import { serverRoute } from '../server-route.js';

type ChatMsg = { kind: 'chat'; text: string } | { kind: 'typing' };
type ChatState = { name: string; color: string };

// A single-param room channel. The name pattern (`room/:roomId`) is the param
// source for `ctx.params`.
const roomChannel = defineChannel('room/:roomId')<ChatMsg>();
// A multi-param channel to pin the params shape behaviorally (an intersection
// `{ org } & { board }` defeats a strict `toEqualTypeOf`, so a missing-param
// negative is used instead).
const boardChannel = defineChannel('org/:org/board/:board')<ChatMsg>();

const initialState: ChatState = { name: 'anon', color: '#000' };

// `route.room(channel, handler)`: attaches the room to a route node, but types
// `ctx.params` from the CHANNEL, exactly like the bare `defineRoom` form.
function _routeRoomProbes() {
  const route = serverRoute('/');
  const ref = route.room(roomChannel, {
    presence: () => initialState,
    onJoin(conn, ctx) {
      // ctx.params is the channel-name params, not the route's.
      expectTypeOf(ctx.params).toEqualTypeOf<{ roomId: string }>();
      // conn carries the Outgoing/State APIs.
      conn.setPresence(initialState);
      conn.send({ kind: 'typing' });
      conn.broadcast({ kind: 'chat', text: 'hi' }, { self: true });
    },
    onMessage(conn, msg) {
      // Incoming message is the channel payload type.
      expectTypeOf(msg).toEqualTypeOf<ChatMsg>();
      conn.broadcast(msg);
    },
  });
  // The ref carries the inference phantoms.
  expectTypeOf(ref.__incoming).toEqualTypeOf<ChatMsg | undefined>();
  expectTypeOf(ref.__state).toEqualTypeOf<ChatState | undefined>();
  expectTypeOf(ref.__params).toEqualTypeOf<{ roomId: string } | undefined>();
}

// Bare `defineRoom(channel, handler)`: same inference as the route form.
function _bareRoomProbes() {
  const ref = defineRoom(roomChannel, {
    presence: () => initialState,
    onJoin(_conn, ctx) {
      expectTypeOf(ctx.params).toEqualTypeOf<{ roomId: string }>();
    },
    onMessage(conn, msg) {
      expectTypeOf(msg).toEqualTypeOf<ChatMsg>();
      conn.send(msg);
    },
  });
  expectTypeOf(ref.__outgoing).toEqualTypeOf<ChatMsg | undefined>();
}

// Multi-param channel: the params object is an intersection, so pin it with a
// missing-key negative rather than a strict equality.
function _multiParamProbes() {
  defineRoom(boardChannel, {
    onJoin(_conn, ctx) {
      // Both params are present.
      expectTypeOf(ctx.params.org).toEqualTypeOf<string>();
      expectTypeOf(ctx.params.board).toEqualTypeOf<string>();
      // @ts-expect-error `missing` is not a param of `org/:org/board/:board`
      ctx.params.missing;
    },
  });
}

// Negatives: wrong Outgoing / wrong State shapes are rejected.
function _negativeProbes() {
  defineRoom(roomChannel, {
    presence: () => initialState,
    onMessage(conn) {
      // @ts-expect-error 'broadcast' is a wrong-kind message (not a ChatMsg)
      conn.broadcast({ kind: 'nope' });
      // @ts-expect-error 'send' rejects a non-ChatMsg
      conn.send({ text: 123 });
    },
    onJoin(conn) {
      // @ts-expect-error setPresence rejects a wrong-shape state
      conn.setPresence({ name: 'x' });
    },
  });
}

void _routeRoomProbes;
void _bareRoomProbes;
void _multiParamProbes;
void _negativeProbes;
