import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { defineStreamObserver, type ServerLoaderCtx } from '@hono-preact/iso';
import { sseGeneratorResponse } from '../sse.js';

const observerCtx: ServerLoaderCtx = {
  scope: 'loader',
  // The SSE pump never reads through `c` / `signal` — observers only see
  // them in onStart/onChunk/etc. via the ctx pointer. A minimal stand-in
  // is enough for the codec-level assertions below.
  c: {} as ServerLoaderCtx['c'],
  signal: new AbortController().signal,
  location: { path: '/', pathParams: {}, searchParams: {} },
  module: 'm',
  loader: 'l',
};

describe('SSE backpressure and abort', () => {
  it('cancels the source generator when the consumer aborts', async () => {
    let returned = false;
    const source = (async function* () {
      try {
        for (let i = 0; ; i++) {
          yield i;
        }
      } finally {
        returned = true;
      }
    })();

    const app = new Hono();
    app.get('/', (c) => sseGeneratorResponse(c, source));

    const res = await app.request('http://localhost/');
    const reader = res.body!.getReader();
    // Read one chunk to ensure the generator has started.
    await reader.read();
    await reader.cancel();
    // Give the generator a moment to observe cancellation.
    await new Promise((r) => setTimeout(r, 10));
    expect(returned).toBe(true);
  });

  it('fires onAbort when the consumer cancels mid-stream', async () => {
    const onAbort = vi.fn();
    const onStart = vi.fn();
    const onChunk = vi.fn();
    const onEnd = vi.fn();
    const observer = defineStreamObserver({
      onStart,
      onChunk,
      onEnd,
      onAbort,
    });

    const source = (async function* () {
      for (let i = 0; ; i++) {
        yield i;
      }
    })();

    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(c, source, {
        observers: [observer],
        observerCtx,
      })
    );

    const res = await app.request('http://localhost/');
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read(); // pull one more frame so chunks > 0 at abort time
    await reader.cancel();
    // Let the cancel callback drain.
    await new Promise((r) => setTimeout(r, 10));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    // chunks should reflect what was produced before cancellation.
    const [, info] = onAbort.mock.calls[0];
    expect(info.chunks).toBeGreaterThanOrEqual(1);
  });

  it('does not fire onAbort when the source completes normally', async () => {
    const onAbort = vi.fn();
    const onEnd = vi.fn();
    const observer = defineStreamObserver({ onAbort, onEnd });

    const source = (async function* () {
      yield 1;
      yield 2;
    })();

    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(c, source, {
        observers: [observer],
        observerCtx,
      })
    );

    const res = await app.request('http://localhost/');
    // Drain the response fully.
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('pauses production when the consumer is slow (backpressure)', async () => {
    // The source advertises how many values have been pulled. The consumer
    // only reads one chunk, then waits. The pump should be ahead by at most
    // one (the chunk in the controller's queue) — not arbitrarily far.
    let produced = 0;
    const source = (async function* () {
      while (true) {
        produced += 1;
        yield produced;
      }
    })();

    const app = new Hono();
    app.get('/', (c) => sseGeneratorResponse(c, source));

    const res = await app.request('http://localhost/');
    const reader = res.body!.getReader();

    // Read one chunk.
    await reader.read();
    // Let the event loop run a bit so the pump would race ahead if
    // backpressure were broken.
    await new Promise((r) => setTimeout(r, 50));

    // Backpressure cap. The pump's `pull` produces one frame per consumer
    // read; the encoder TransformStream's default queue holds the frame
    // that's been emitted but not yet consumed. So `produced` should be
    // bounded by a small constant (typically 2) — emphatically not unbounded.
    expect(produced).toBeLessThan(20);

    await reader.cancel();
  });
});
