// Type-level contract for defineSocket. Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import {
  defineSocket,
  type SocketRef,
  type SocketHandler,
} from '../define-socket.js';
import { serverRoute } from '../server-route.js';
import type { Serialize } from '../internal/serialize.js';

type In = { kind: 'ping' } | { kind: 'say'; text: string };
type Out = { kind: 'pong'; at: number } | { kind: 'said'; text: string };

function _probes() {
  const ref = defineSocket<In, Out, { joinedAt: number }>({
    open(socket) {
      // socket.send is typed to Outgoing; socket.data to Readonly<Data>.
      expectTypeOf(socket.data).toEqualTypeOf<Readonly<{ joinedAt: number }>>();
      socket.send({ kind: 'pong', at: 1 });
      // @ts-expect-error wrong outgoing shape
      socket.send({ kind: 'nope' });
      return () => undefined; // teardown allowed
    },
    message(socket, msg) {
      expectTypeOf(msg).toEqualTypeOf<In>();
      if (msg.kind === 'say') socket.send({ kind: 'said', text: msg.text });
    },
  });
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out>>();
}

// Deep readonly (#222 item 9): socket.data is recursively readonly, so a NESTED
// in-place mutation is a compile error too (it would silently vanish on a CF DO
// re-read, like a top-level one).
function _deepReadonlyDataProbe() {
  const ref = defineSocket<
    In,
    Out,
    { profile: { name: string; tags: string[] } }
  >({
    open(socket) {
      expectTypeOf(socket.data).toEqualTypeOf<{
        readonly profile: {
          readonly name: string;
          readonly tags: readonly string[];
        };
      }>();
      // @ts-expect-error a top-level socket.data property is readonly
      socket.data.profile = { name: 'b', tags: [] };
      // @ts-expect-error a NESTED socket.data property is readonly (deep)
      socket.data.profile.name = 'b';
      // @ts-expect-error a nested socket.data array is a readonly array
      socket.data.profile.tags.push('x');
    },
  });
  void ref;
}

// route.socket's `data` factory receives the Hono Context; `open` receives
// ONLY the socket (no Context), so a socket handler is portable to Cloudflare
// where it runs inside a Durable Object with no live Context.
function _routeSocketProbe() {
  const route = serverRoute('/movies/:id');
  const ref = route.socket<In, Out, { joinedAt: number }>({
    data(c) {
      // c is the Hono Context for the upgrade request.
      expectTypeOf(c).not.toBeNever();
      return { joinedAt: 1 };
    },
    open(socket) {
      // open's only argument is the socket; its data is the factory result.
      expectTypeOf(socket.data).toEqualTypeOf<Readonly<{ joinedAt: number }>>();
    },
  });
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out>>();
}

// `open` takes only the socket now: a two-argument open does not type-check.
function _openArityProbe() {
  // @ts-expect-error open no longer receives a Context as a second argument
  const _bad: SocketHandler<In, Out, undefined> = { open: (_socket, _c) => {} };
  void _bad;
}

// Probe: ref.useSocket() method form typechecks and infers message types.
function _useSocketMethodProbe() {
  const ref = defineSocket<In, Out, undefined>({});
  // ref is typed as SocketRef<In, Out>; .useSocket should exist.
  const result = ref.useSocket({
    onMessage(msg) {
      // msg should be Serialize<Out>
      expectTypeOf(msg).toEqualTypeOf<Serialize<Out>>();
    },
  });
  // send should accept In
  expectTypeOf(result.send).toEqualTypeOf<(msg: In) => void>();

  // It should also be callable with no options.
  ref.useSocket();

  // Typed directly from SocketRef<In, Out>
  const ref2: SocketRef<In, Out> = ref;
  ref2.useSocket({
    onMessage(msg) {
      expectTypeOf(msg).toEqualTypeOf<Serialize<Out>>();
    },
  });
}

// Probe: an async data factory typechecks (data?: (c: Context) => Data | Promise<Data>).
function _asyncDataProbe() {
  type In = { kind: 'ping' } | { kind: 'say'; text: string };
  type Out = { kind: 'pong'; at: number } | { kind: 'said'; text: string };
  const refAsync = defineSocket<In, Out, { joinedAt: number }>({
    data: async (c) => {
      expectTypeOf(c).not.toBeNever();
      return { joinedAt: 1 };
    },
  });
  expectTypeOf(refAsync).toEqualTypeOf<SocketRef<In, Out>>();
  void refAsync;
}

void _probes;
void _routeSocketProbe;
void _openArityProbe;
void _useSocketMethodProbe;
void _asyncDataProbe;
void _deepReadonlyDataProbe;
