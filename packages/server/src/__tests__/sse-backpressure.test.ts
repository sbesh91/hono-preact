import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { sseGeneratorResponse } from '../sse.js';

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
});
