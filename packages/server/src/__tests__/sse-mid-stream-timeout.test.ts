import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';
import { defineLoader } from '@hono-preact/iso';
import { readSSE } from '@hono-preact/iso/internal';

const location = { path: '/', pathParams: {}, searchParams: {} };

describe('sse mid-stream timeout', () => {
  it('emits event: timeout when the timeout fires after the stream has started', async () => {
    const ref = defineLoader(
      async function* ({ signal }) {
        yield 'first';
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        // Re-throw after abort so the SSE pump enters its catch path with
        // the timeout reason live on the composed signal.
        throw signal.reason;
      },
      { __moduleKey: 'streamy', __loaderName: 'list', timeoutMs: 75 }
    );

    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler({
        './pages/streamy.server.ts': {
          __moduleKey: 'streamy',
          serverLoaders: { list: ref },
        },
      })
    );

    const res = await app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'streamy', loader: 'list', location }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events: { event: string; data: string }[] = [];
    if (res.body) {
      for await (const ev of readSSE(res.body)) events.push(ev);
    }

    expect(events.some((e) => e.event === 'message' && e.data === '"first"')).toBe(true);
    const timeoutEvent = events.find((e) => e.event === 'timeout');
    expect(timeoutEvent).toBeDefined();
    expect(JSON.parse(timeoutEvent!.data)).toMatchObject({ timeoutMs: 75 });
  });
});
