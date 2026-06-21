// Type-level contract for defineSocket. Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import { defineSocket, type SocketRef } from '../define-socket.js';
import { serverRoute } from '../server-route.js';

type In = { kind: 'ping' } | { kind: 'say'; text: string };
type Out = { kind: 'pong'; at: number } | { kind: 'said'; text: string };

function _probes() {
  const ref = defineSocket<In, Out, { joinedAt: number }>({
    open(socket) {
      // socket.send is typed to Outgoing; socket.data to Data.
      expectTypeOf(socket.data).toEqualTypeOf<{ joinedAt: number }>();
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

// route.socket ctx has `c` (Hono Context) but no `params` field in this release.
function _routeSocketProbe() {
  const route = serverRoute('/movies/:id');
  const ref = route.socket<In, Out, undefined>({
    open(_socket, ctx) {
      // ctx.c is the Hono Context for the upgrade request.
      expectTypeOf(ctx.c).not.toBeNever();
      // @ts-expect-error sockets have no typed params in this release
      void ctx.params;
    },
  });
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out>>();
}

void _probes;
void _routeSocketProbe;
