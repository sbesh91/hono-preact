import { describe, it, expect, afterEach } from 'vitest';
import { liveStream, serverRoute } from '../server-route.js';
import { defineLoader } from '../define-loader.js';
import { publish } from '../pubsub.js';
import { __resetPubSubForTesting } from '../internal/pubsub.js';
import { defineChannel } from '../define-channel.js';

afterEach(() => {
  __resetPubSubForTesting();
});

const pingChannel = defineChannel('test-live-stream-ping')();

describe('liveStream', () => {
  it('yields load() result on first connect', async () => {
    const ac = new AbortController();
    const load = async () => 42;
    const gen = liveStream({
      topic: () => pingChannel.key(),
      load,
    });

    const iter = gen({ signal: ac.signal });
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe(42);

    // Clean up.
    ac.abort();
  });

  it('re-yields load() on each publish to the topic', async () => {
    const ac = new AbortController();
    let count = 0;
    const load = async () => ++count;

    const gen = liveStream({
      topic: () => pingChannel.key(),
      load,
    });

    const iter = gen({ signal: ac.signal });

    // First value: load() called once.
    const r1 = await iter.next();
    expect(r1.value).toBe(1);
    expect(count).toBe(1);

    // Start waiting for the next value BEFORE publishing. Calling iter.next()
    // resumes the generator synchronously into the for-await loop inside
    // liveStream, which calls subscribeTopic and registers the subscription.
    // Publishing before iter.next() would miss the subscription entirely.
    const r2p = iter.next();
    publish(pingChannel.key());
    const r2 = await r2p;
    expect(r2.value).toBe(2);
    expect(count).toBe(2);

    // Another publish: same pattern.
    const r3p = iter.next();
    publish(pingChannel.key());
    const r3 = await r3p;
    expect(r3.value).toBe(3);
    expect(count).toBe(3);

    ac.abort();
  });

  it('terminates when the signal is aborted', async () => {
    const ac = new AbortController();
    const load = async () => 1;

    const gen = liveStream({
      topic: () => pingChannel.key(),
      load,
    });

    const iter = gen({ signal: ac.signal });

    // Consume the first value.
    await iter.next();

    // Abort the signal. The next pull should eventually resolve as done.
    ac.abort();
    const done = await iter.next();
    expect(done.done).toBe(true);
  });

  it('returns an async generator function', () => {
    const gen = liveStream({
      topic: () => pingChannel.key(),
      load: async () => 99,
    });
    expect(typeof gen).toBe('function');
    const ac = new AbortController();
    const iter = gen({ signal: ac.signal });
    expect(typeof iter[Symbol.asyncIterator]).toBe('function');
    // Clean up.
    ac.abort();
  });

  // Marker-implied liveness: liveStream should tag its output so that
  // defineLoader and route.loader infer live: true without an explicit flag.
  it('implies live: true on a defineLoader ref without an explicit flag', () => {
    const ref = defineLoader(
      liveStream({
        topic: () => pingChannel.key(),
        load: async () => 42,
      })
    );
    expect(ref.live).toBe(true);
  });

  it('implies live: true and preserves __routeId on a route-bound ref', () => {
    const route = serverRoute('/r/:id');
    const ref = route.loader(
      liveStream({
        topic: () => pingChannel.key(),
        load: async () => 42,
      })
    );
    expect(ref.live).toBe(true);
    expect(ref.__routeId).toBe('/r/:id');
  });

  it('defaults live to false for a raw generator loader', () => {
    const ref = defineLoader(async function* () {
      yield 1;
    });
    expect(ref.live).toBe(false);
  });

  it('timeoutMs defaults to false for a liveStream ref (no explicit flag)', () => {
    const ref = defineLoader(
      liveStream({
        topic: () => pingChannel.key(),
        load: async () => 42,
      })
    );
    // live: true loaders default timeoutMs to false (no 30s cap).
    expect(ref.timeoutMs).toBe(false);
  });
});
