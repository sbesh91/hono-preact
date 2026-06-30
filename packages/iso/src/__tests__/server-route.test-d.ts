// route.loader with liveStream returns a streaming LoaderRef<T, true>:
// accumulating .View only. No explicit { live: true } flag needed; liveStream
// is inherently live and the marker implies it.
//
// Inference note on ctx params: TypeScript contextually types arrow-function
// expressions but NOT generic call-expression arguments. `liveStream({...})` is
// a generic call, so without an explicit C annotation TypeScript infers
// C = { signal: AbortSignal } (the constraint bound), meaning ctx.location.*
// is unavailable inside the callbacks. Users with typed params should annotate:
//   liveStream<T, LoaderCtx<RouteParams<'/r/:id'>>>({ topic, load })
// The test below covers both the annotated form and the plain typed-ref checks.
import { expectTypeOf } from 'vitest';
import { serverRoute, liveStream } from '../server-route.js';
import { defineChannel } from '../define-channel.js';
import type { LoaderCtx } from '../define-loader.js';
import type { RouteParams } from '../internal/typed-routes.js';

function _probes() {
  const route = serverRoute('/board/:projectId');
  const boardChannel = defineChannel('board/:projectId')<{ n: number }>();

  // liveStream implies live: true; no explicit flag needed.
  // Without a C annotation, ctx is typed as { signal: AbortSignal }.
  const ref = route.loader(
    liveStream({
      topic: (_ctx) => boardChannel.key({ projectId: 'p1' }),
      load: async () => ({ count: 1 }),
    })
  );

  // Streaming ref: useData and Boundary are never; accumulating View is available.
  expectTypeOf(ref.useData).toBeNever();
  expectTypeOf(ref.Boundary).toBeNever();
  ref.View<number[]>(
    (s) => {
      if (s.status === 'open' || s.status === 'closed') {
        expectTypeOf(s.data).toEqualTypeOf<number[]>();
      }
      return null;
    },
    { initial: [], reduce: (acc) => acc }
  );

  // With an explicit C annotation, ctx.location.pathParams.* is typed from
  // the route pattern. Users who access ctx in liveStream callbacks should
  // annotate C when typed params are needed.
  route.loader(
    liveStream<{ count: number }, LoaderCtx<RouteParams<'/board/:projectId'>>>({
      topic: (ctx) => {
        expectTypeOf(ctx.location.pathParams.projectId).toEqualTypeOf<string>();
        return boardChannel.key({
          projectId: ctx.location.pathParams.projectId,
        });
      },
      load: async () => ({ count: 1 }),
    })
  );
}

void _probes;
