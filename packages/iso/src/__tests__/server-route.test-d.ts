// route.liveLoader returns a live LoaderRef: accumulating .View only.
import { expectTypeOf } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineChannel } from '../define-channel.js';

function _probes() {
  const route = serverRoute('/board/:projectId');
  const boardChannel = defineChannel('board/:projectId')<{ n: number }>();

  const ref = route.liveLoader({
    topic: (ctx) =>
      boardChannel.key({ projectId: ctx.location.pathParams.projectId }),
    load: async () => ({ count: 1 }),
  });

  // Live ref: useData and Boundary are never; accumulating View is available.
  expectTypeOf(ref.useData).toBeNever();
  ref.View<number[]>(
    (args) => {
      expectTypeOf(args.data).toEqualTypeOf<number[]>();
      return null;
    },
    { initial: [], reduce: (acc) => acc }
  );

  // ctx.location.pathParams.projectId is typed from the route pattern.
  route.liveLoader({
    topic: (ctx) => {
      expectTypeOf(ctx.location.pathParams.projectId).toEqualTypeOf<string>();
      return boardChannel.key({ projectId: ctx.location.pathParams.projectId });
    },
    load: async () => ({ count: 1 }),
  });
}

void _probes;
