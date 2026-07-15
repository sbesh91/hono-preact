// Type-level contract for defineSocket. Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import {
  defineSocket,
  type SocketRef,
  type SocketHandler,
} from '../define-socket.js';
import { serverRoute } from '../server-route.js';
import { useSocket } from '../use-socket.js';
import type { UseSocketArgs } from '../index.js';
import type { Serialize } from '../internal/serialize.js';
import type { Context } from 'hono';

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
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out, { id: string }>>();
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

// A param-bearing binding types the data factory's params from the route.
// Data is left at its default (undefined) here: only Incoming/Outgoing are
// given explicitly, so a returned value would need a third explicit type
// argument to type-check (TS does not infer a defaulted trailing type
// parameter once earlier ones are given explicitly).
serverRoute('/board/:id').socket<{ ping: true }, { pong: true }>({
  data: (_c: Context, params) => {
    expectTypeOf(params).toEqualTypeOf<{ id: string }>();
    return undefined;
  },
});

// A bare socket's factory params are {} (second arg present but empty).
defineSocket<{ ping: true }, { pong: true }>({
  data: (_c: Context, params) => {
    expectTypeOf(params).toEqualTypeOf<{}>();
    return undefined;
  },
});

// `useSocket`'s `params` option: required and typed iff the bound route has
// params (mirrors `useRoom`'s `key` option probes).
declare const boundSocketRef: SocketRef<
  { ping: true },
  { pong: true },
  { id: string }
>;
declare const bareSocketRef: SocketRef<{ ping: true }, { pong: true }>;

// Param-bearing binding: `params` is required and typed.
useSocket(boundSocketRef, { params: { id: 'b1' } });
// @ts-expect-error missing required params
useSocket(boundSocketRef, {});
// @ts-expect-error wrong param name
useSocket(boundSocketRef, { params: { boardId: 'b1' } });

// Bare socket: no `params` option.
useSocket(bareSocketRef, {});
// @ts-expect-error bare socket takes no params
useSocket(bareSocketRef, { params: { id: 'b1' } });

// The options argument itself is required exactly when the route has params:
// omitting it entirely on a bound ref must be a type error (previously it
// compiled, since `opts` was optional, and only failed once an options object
// was actually passed).
useSocket(bareSocketRef);
useSocket(bareSocketRef, { onMessage() {} });
// @ts-expect-error a param-bearing binding requires the options argument
useSocket(boundSocketRef);
useSocket(boundSocketRef, { params: { id: 'b1' } });

// The ref-method form (`ref.useSocket(...)`) carries the same hole and the
// same fix: the options argument is required exactly when the bound route has
// params.
declare const boundSocketRefMethod: SocketRef<
  { ping: true },
  { pong: true },
  { id: string }
>;
declare const bareSocketRefMethod: SocketRef<{ ping: true }, { pong: true }>;

bareSocketRefMethod.useSocket();
bareSocketRefMethod.useSocket({ onMessage() {} });
// @ts-expect-error a param-bearing binding requires the options argument
boundSocketRefMethod.useSocket();
boundSocketRefMethod.useSocket({ params: { id: 'b1' } });
// @ts-expect-error missing required params
boundSocketRefMethod.useSocket({});

// Migration path for the (ref, opts?) -> conditional rest tuple break:
// `UseSocketArgs<R>` is exported from the public barrel so a generic wrapper
// can NAME the rest tuple and forward it, rather than re-declaring `opts` as
// a plain optional parameter (which no longer matches `useSocket`'s own
// signature for a param-bearing `R`).
function _genericWrapperProbe<R extends SocketRef<unknown, unknown>>(
  ref: R,
  ...args: UseSocketArgs<R>
) {
  return useSocket(ref, ...args);
}
void _genericWrapperProbe;

// Finding 6 (#274 round-8 fix) revisited (#274 param-contract finalization):
// `useSocket`'s generic constraint reads types off a structural shape
// (`AnySocketRefShape`, use-socket.ts) with every field optional, so it
// cannot require a real `SocketRef` argument without either (a) a required
// brand field with no runtime counterpart -- which broke the released
// public `SocketRef` type for a hand-rolled mock or a
// `const m: SocketRef<A, B> = {...}` annotation -- or (b) requiring the
// `useSocket` method itself, which reintroduces the excessively-deep
// recursion the structural shape exists to avoid (checking `SocketRef`
// against a shape whose `useSocket` parameter type references `SocketRef`
// again). Neither is worth it for this compile-time nicety, so
// `useSocket({})` DOES type-check: it fails loudly at runtime (no
// `moduleKey`/`socketName`, so the connection never becomes `ready`), which
// is a caught user error, not a security gap.
useSocket({});
useSocket({ __incoming: {}, __outgoing: {} });

void _probes;
void _routeSocketProbe;
void _openArityProbe;
void _useSocketMethodProbe;
void _asyncDataProbe;
void _deepReadonlyDataProbe;
