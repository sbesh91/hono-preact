// Type-level contract for defineChannel. Run under `pnpm test:types`. Proves the
// channel name's `:params` are typed (via the reused RouteParams engine), the
// payload rides the Topic brand, and misuse is a compile error.
import { expectTypeOf } from 'vitest';
import { defineChannel, type Topic } from '../define-channel.js';

function _probes() {
  const board = defineChannel('board/:projectId')<{
    taskId: string;
    to: string;
  }>();

  // key() requires the typed params and yields a Topic carrying the payload.
  const t = board.key({ projectId: 'p1' });
  expectTypeOf(t).toEqualTypeOf<Topic<{ taskId: string; to: string }>>();

  // @ts-expect-error missing required param
  board.key({});
  // @ts-expect-error wrong param name
  board.key({ project: 'p1' });
  // @ts-expect-error a param object is required
  board.key();

  // Multiple params: each is required and typed. RouteParams yields an
  // intersection (`{roomId} & {userId}`), so the params shape is pinned
  // behaviorally (omitting either param is an error) rather than by a strict
  // toEqualTypeOf against a merged object, which the intersection would fail.
  // The missing-param errors also catch a regression that widened the params to
  // a looser type such as Record<string, string>.
  const room = defineChannel('room/:roomId/user/:userId')<number>();
  expectTypeOf(room.key({ roomId: 'r1', userId: 'u9' })).toEqualTypeOf<
    Topic<number>
  >();
  // @ts-expect-error missing userId
  room.key({ roomId: 'r1' });
  // @ts-expect-error missing roomId
  room.key({ userId: 'u9' });

  // A param-less channel: key() takes no argument.
  const activity = defineChannel('activity')<string>();
  expectTypeOf(activity.key()).toEqualTypeOf<Topic<string>>();
  // @ts-expect-error a param-less channel takes no argument
  activity.key({ nope: 'x' });

  // A payload-less (signal) channel defaults to Topic<void>.
  const ping = defineChannel('ping/:id')();
  expectTypeOf(ping.key({ id: '1' })).toEqualTypeOf<Topic<void>>();
}

void _probes;
