import { describe, it, expectTypeOf } from 'vitest';
import { eventStream } from '../event-stream.js';
import { defineChannel } from '../define-channel.js';

describe('eventStream typing', () => {
  it('yields the channel payload in wire shape (Serialize<P>)', () => {
    const ch = defineChannel('board/:projectId')<{
      taskId: string;
      at: Date;
    }>();
    const gen = eventStream(
      ch.key({ projectId: 'p1' }),
      new AbortController().signal
    );
    // Date serializes to its ISO string on the wire.
    expectTypeOf(gen).toEqualTypeOf<
      AsyncGenerator<{ taskId: string; at: string }, void, unknown>
    >();
  });
});
