import { describe, it, expect, afterEach } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineChannel } from '../define-channel.js';
import { publish } from '../pubsub.js';
import { inProcessBackend, installPubSubBackend } from '../internal/pubsub.js';
import type { LoaderCtx } from '../define-loader.js';

afterEach(() => installPubSubBackend(inProcessBackend));

const channel = defineChannel('counter')();

function makeCtx(signal: AbortSignal): LoaderCtx<Record<string, string>> {
  // Minimal ctx: the live generator only reads ctx.signal and (via topic/load) nothing else here.
  return {
    // c is unused by this loader; cast-free minimal stub is not possible for Context,
    // so the loader's load/topic must not touch ctx.c (they do not).
    c: undefined as never,
    location: { path: '/', searchParams: {}, pathParams: {} },
    signal,
  };
}

describe('channel-driven live loader (integration)', () => {
  it('yields initial load then re-runs on publish, and fans out to two subscribers', async () => {
    let count = 0;
    const route = serverRoute('/counter');
    const ref = route.liveLoader<{ count: number }>({
      topic: () => channel.key(),
      load: async () => ({ count }),
    });

    const acA = new AbortController();
    const acB = new AbortController();
    const a = ref.fn(makeCtx(acA.signal)) as AsyncGenerator<{ count: number }>;
    const b = ref.fn(makeCtx(acB.signal)) as AsyncGenerator<{ count: number }>;

    expect((await a.next()).value).toEqual({ count: 0 }); // initial
    expect((await b.next()).value).toEqual({ count: 0 });

    // both are now awaiting a publish
    const aNext = a.next();
    const bNext = b.next();
    count = 1;
    publish(channel.key());

    expect((await aNext).value).toEqual({ count: 1 }); // fan-out re-run
    expect((await bNext).value).toEqual({ count: 1 });

    // teardown
    acA.abort();
    acB.abort();
    expect((await a.next()).done).toBe(true);
    expect((await b.next()).done).toBe(true);
  });
});
