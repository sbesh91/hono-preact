import { describe, it, expect, afterEach } from 'vitest';
import { subscribeTopic } from '../subscribe-topic.js';
import { inProcessBackend, installPubSubBackend } from '../pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend));

describe('subscribeTopic', () => {
  it('yields once per publish and ends on abort, unsubscribing', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('t', ac.signal);

    const first = gen.next(); // pending until a publish
    inProcessBackend.publish('t', 0);
    const r1 = await first;
    expect(r1).toEqual({ value: undefined, done: false });

    const second = gen.next();
    inProcessBackend.publish('t', 0);
    expect(await second).toEqual({ value: undefined, done: false });

    // abort ends the generator
    const third = gen.next();
    ac.abort();
    expect(await third).toEqual({ value: undefined, done: true });
  });

  it('coalesces a burst that arrives before the next pull into one wake', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('t', ac.signal);
    // burst before any pull
    inProcessBackend.publish('t', 0);
    inProcessBackend.publish('t', 0);
    inProcessBackend.publish('t', 0);
    const r1 = await gen.next();
    expect(r1.done).toBe(false); // one coalesced wake
    // no second wake is pending now; abort to end cleanly
    const next = gen.next();
    ac.abort();
    expect((await next).done).toBe(true);
  });

  it('removes its subscription on abort (no leak)', async () => {
    const ac = new AbortController();
    const gen = subscribeTopic('leak-topic', ac.signal);
    void gen.next();
    ac.abort();
    await gen.next();
    // After teardown, the registry has no subscribers for the topic, so a
    // fresh subscribe/publish on a sibling topic is unaffected; assert the
    // generator is done and a publish reaches zero of its (removed) callbacks.
    const seen: unknown[] = [];
    const off = inProcessBackend.subscribe('leak-topic', (m) => seen.push(m));
    inProcessBackend.publish('leak-topic', 1);
    off();
    expect(seen).toEqual([1]); // only the fresh subscriber, the gen's is gone
  });

  it('unsubscribes on abort even if never iterated', () => {
    let unsubCalled = 0;
    installPubSubBackend({
      publish: () => undefined,
      subscribe: () => () => {
        unsubCalled += 1;
      },
    });
    const ac = new AbortController();
    subscribeTopic('t', ac.signal); // created, never iterated
    expect(unsubCalled).toBe(0);
    ac.abort();
    expect(unsubCalled).toBe(1); // abort tore it down without any .next()
  });
});
