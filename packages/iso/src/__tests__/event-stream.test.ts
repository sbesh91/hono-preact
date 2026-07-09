import { describe, it, expect, afterEach } from 'vitest';
import { eventStream } from '../event-stream.js';
import { publish } from '../pubsub.js';
import { defineChannel } from '../define-channel.js';
import {
  installPubSubBackend,
  __resetPubSubForTesting,
  type PubSubBackend,
} from '../internal/pubsub.js';

afterEach(() => {
  __resetPubSubForTesting();
});

describe('eventStream', () => {
  it('yields published payloads in publish order', async () => {
    const ch = defineChannel('es-order')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const first = gen.next();
    publish(ch.key(), { n: 1 });
    publish(ch.key(), { n: 2 });
    expect((await first).value).toEqual({ n: 1 });
    expect((await gen.next()).value).toEqual({ n: 2 });
    ac.abort();
  });

  it('buffers a publish that lands before the first pull (eager subscription)', async () => {
    const ch = defineChannel('es-early')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    publish(ch.key(), { n: 7 });
    expect((await gen.next()).value).toEqual({ n: 7 });
    ac.abort();
  });

  it('ends when the signal aborts', async () => {
    const ch = defineChannel('es-abort')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const parked = gen.next();
    ac.abort();
    expect((await parked).done).toBe(true);
  });

  it('unsubscribes on abort (a later publish does not revive the stream)', async () => {
    const ch = defineChannel('es-unsub')<{ n: number }>();
    const ac = new AbortController();
    const gen = eventStream(ch.key(), ac.signal);
    const parked = gen.next();
    ac.abort();
    await parked;
    publish(ch.key(), { n: 9 });
    expect((await gen.next()).done).toBe(true);
  });

  it('removes the subscription on abort even if the stream was never pulled', () => {
    let unsubbed = false;
    const fake: PubSubBackend = {
      publish() {},
      subscribe() {
        return () => {
          unsubbed = true;
        };
      },
    };
    installPubSubBackend(fake);
    const ac = new AbortController();
    eventStream(defineChannel('es-leak')<{ n: number }>().key(), ac.signal);
    ac.abort();
    expect(unsubbed).toBe(true);
  });

  it('throws out of the generator when the backend reports a drop', async () => {
    let failSub: ((error: unknown) => void) | undefined;
    const fake: PubSubBackend = {
      publish() {},
      subscribe(_topic, _onMessage, onError) {
        failSub = onError;
        return () => {};
      },
    };
    installPubSubBackend(fake);
    const ac = new AbortController();
    const gen = eventStream(
      defineChannel('es-drop')<{ n: number }>().key(),
      ac.signal
    );
    const parked = gen.next();
    failSub?.(new Error('socket died'));
    await expect(parked).rejects.toThrow('socket died');
    ac.abort();
  });
});
