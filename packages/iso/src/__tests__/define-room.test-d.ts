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
import { useRoom } from '../use-room.js';
import type { UseRoomArgs } from '../index.js';
import type { Serialize } from '../internal/serialize.js';
import type { PresenceMember } from '../internal/room-envelope.js';
import type { RoomRef } from '../define-room.js';

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

// Probe: ref.useRoom() method form. `key` is typed from the channel params,
// `onMessage` infers `(Serialize<Outgoing>, from)`, and the result exposes
// `send`/`setPresence`/`members`/`self` (no client `broadcast`).
function _useRoomMethodProbe() {
  const ref = defineRoom(roomChannel, { presence: () => initialState });

  const result = ref.useRoom({
    // key is required (the channel has a `:roomId` param) and typed.
    key: { roomId: 'r1' },
    presence: initialState,
    onMessage(msg, from) {
      expectTypeOf(msg).toEqualTypeOf<Serialize<ChatMsg>>();
      expectTypeOf(from).toEqualTypeOf<string>();
    },
  });

  // send accepts the Incoming type; setPresence accepts State.
  expectTypeOf(result.send).toEqualTypeOf<(msg: ChatMsg) => void>();
  expectTypeOf(result.setPresence).toEqualTypeOf<(state: ChatState) => void>();
  // members is a readonly roster of PresenceMember; member state may be
  // undefined (a room with no presence() seed, or before a member's first
  // presence frame), so the roster state type is `State | undefined`. self is
  // also optional (undefined until the first snapshot arrives).
  expectTypeOf(result.members).toEqualTypeOf<
    ReadonlyArray<PresenceMember<ChatState | undefined>>
  >();
  expectTypeOf(result.self).toEqualTypeOf<
    PresenceMember<ChatState | undefined> | undefined
  >();
  // No client broadcast on the result (fan-out is server-mediated).
  // @ts-expect-error useRoom result has no `broadcast`
  void result.broadcast;
}

// Negative: a `:param` channel makes `key` required.
function _keyRequiredProbe() {
  const ref = defineRoom(roomChannel, {});
  // @ts-expect-error `key` is required for a channel with a `:roomId` param
  ref.useRoom({});
  // @ts-expect-error `key` must match the channel params (missing roomId)
  ref.useRoom({ key: {} });
}

// A param-less channel makes `key` optional.
function _keyOptionalProbe() {
  const signalChannel = defineChannel('lobby')<ChatMsg>();
  const ref = defineRoom(signalChannel, {});
  // No key needed; opts is fully optional.
  ref.useRoom();
  ref.useRoom({ onMessage: () => undefined });
}

// The options argument itself is required exactly when the channel has
// params: omitting it entirely on a bound ref is a type error (mirrors
// `useSocket`'s `params` arity probes in define-socket.test-d.ts). Also pins
// that a param-less channel's `key` option rejects a stray key value rather
// than silently accepting it: `KeyOption`'s no-params branch is `{ key?: never }`,
// not `{ key?: {} }` (the latter would structurally accept almost any object).
// Covers both the free-function `useRoom(ref, opts)` and the `ref.useRoom(opts)`
// method form.
function _optionsArityProbe() {
  const boundRef = defineRoom(roomChannel, {});
  const bareChannel = defineChannel('lobby')<ChatMsg>();
  const bareRef = defineRoom(bareChannel, {});

  // Free-function form.
  useRoom(bareRef);
  useRoom(bareRef, { onMessage: () => undefined });
  useRoom(boundRef, { key: { roomId: 'r1' } });
  // @ts-expect-error a param-bearing channel requires the options argument
  useRoom(boundRef);
  // @ts-expect-error a stray `key` on a param-less channel is rejected
  useRoom(bareRef, { key: { junk: 'x' } });

  // ref-method form: the identical arity rule.
  bareRef.useRoom();
  bareRef.useRoom({ onMessage: () => undefined });
  boundRef.useRoom({ key: { roomId: 'r1' } });
  // @ts-expect-error a param-bearing channel requires the options argument
  boundRef.useRoom();
  // @ts-expect-error a stray `key` on a param-less channel is rejected
  bareRef.useRoom({ key: { junk: 'x' } });
}

// data factory: infers Data from the factory return and seeds conn.data in
// onJoin and onMessage. The factory receives a live Context; onJoin does NOT.
function _dataFactoryProbe() {
  type UserData = { name: string; role: string };
  import('hono').then(() => {}); // type-only; Context import rides the define-room module
  defineRoom(roomChannel, {
    // data runs at the edge with the live Context.
    data(c) {
      // c is Context (from hono)
      expectTypeOf(c.req.query).toBeFunction();
      const result: UserData = {
        name: c.req.query('name') ?? 'Guest',
        role: 'user',
      };
      return result;
    },
    onJoin(conn, ctx) {
      // ctx has params but NOT c.
      expectTypeOf(ctx.params).toEqualTypeOf<{ roomId: string }>();
      // conn.data is Readonly<Data> inferred from the data factory.
      expectTypeOf(conn.data).toEqualTypeOf<Readonly<UserData>>();
      // @ts-expect-error ctx.c does not exist: live Context is not passed to room callbacks
      ctx.c;
    },
    onMessage(conn) {
      // onMessage also sees conn.data typed as Data.
      expectTypeOf(conn.data).toEqualTypeOf<Readonly<UserData>>();
    },
  });
}

// A factory-less room defaults Data to `undefined` (parity with defineSocket),
// so reading conn.data is `undefined`, not an object. This is the trap-1 fix.
function _noDataFactoryProbe() {
  defineRoom(roomChannel, {
    onJoin(conn, ctx) {
      expectTypeOf(conn.data).toEqualTypeOf<Readonly<undefined>>();
      // ctx still has no c.
      // @ts-expect-error ctx.c does not exist
      ctx.c;
    },
  });
}

// Probe: an async data factory on a room typechecks.
function _asyncRoomDataProbe() {
  defineRoom(roomChannel, {
    data: async (c) => {
      expectTypeOf(c.req.query).toBeFunction();
      return { name: 'async-user', role: 'user' };
    },
    onJoin(conn) {
      expectTypeOf(conn.data).toEqualTypeOf<
        Readonly<{ name: string; role: string }>
      >();
    },
  });
}

// Deep readonly (#222 item 9): `.data` is JSON-serialized onto a forward header
// and re-read fresh per event, so a NESTED in-place mutation silently vanishes
// on a Cloudflare Durable Object just like a top-level one. ReadonlyData is
// recursive, so nested `.data` is readonly too (a shallow Readonly only froze
// the top level and let `conn.data.profile.name = ...` type-check).
function _deepReadonlyDataProbe() {
  type Nested = { profile: { name: string; tags: string[] } };
  defineRoom(roomChannel, {
    data: (): Nested => ({ profile: { name: 'a', tags: [] } }),
    onJoin(conn) {
      expectTypeOf(conn.data).toEqualTypeOf<{
        readonly profile: {
          readonly name: string;
          readonly tags: readonly string[];
        };
      }>();
      // @ts-expect-error a top-level `.data` property is readonly
      conn.data.profile = { name: 'b', tags: [] };
      // @ts-expect-error a NESTED `.data` property is readonly (the deep part)
      conn.data.profile.name = 'b';
      // @ts-expect-error a nested `.data` array is a readonly array
      conn.data.profile.tags.push('x');
    },
  });
}

// Migration path for the (ref, opts?) -> conditional rest tuple break:
// `UseRoomArgs<R>` is exported from the public barrel so a generic wrapper
// can NAME the rest tuple and forward it (mirrors the identical
// `UseSocketArgs` probe in define-socket.test-d.ts).
function _genericWrapperProbe<
  R extends RoomRef<unknown, unknown, unknown, unknown>,
>(ref: R, ...args: UseRoomArgs<R>) {
  return useRoom(ref, ...args);
}
void _genericWrapperProbe;

// Finding 6 (#274 round-8 fix) revisited (#274 param-contract finalization):
// the identical `useSocket({})` reasoning (define-socket.test-d.ts), for
// `useRoom`. `RoomRefShape`'s fields are all optional (no required brand, no
// required method: both reintroduce a problem worse than the compile-time
// nicety they buy -- see that file's comment), so `useRoom({})` DOES
// type-check now; it fails loudly at runtime instead.
useRoom({});
useRoom({ __incoming: {}, __outgoing: {} });

void _routeRoomProbes;
void _bareRoomProbes;
void _multiParamProbes;
void _negativeProbes;
void _useRoomMethodProbe;
void _keyRequiredProbe;
void _keyOptionalProbe;
void _optionsArityProbe;
void _dataFactoryProbe;
void _noDataFactoryProbe;
void _asyncRoomDataProbe;
void _deepReadonlyDataProbe;
