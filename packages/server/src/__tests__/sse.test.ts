import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sseGeneratorResponse, sseReadableStreamResponse } from '../sse.js';

function makeApp(handler: (c: Context) => Response) {
  const app = new Hono();
  app.get('/x', handler);
  return app;
}

describe('sseGeneratorResponse', () => {
  it('sets the standard SSE response headers', async () => {
    async function* gen() {
      yield { a: 1 };
    }
    const res = await makeApp((c) => sseGeneratorResponse(c, gen())).request(
      '/x'
    );
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('emits each yield as a data event', async () => {
    async function* gen() {
      yield { a: 1 };
      yield { a: 2 };
    }
    const res = await makeApp((c) => sseGeneratorResponse(c, gen())).request(
      '/x'
    );
    const body = await res.text();
    expect(body).toContain('data: {"a":1}');
    expect(body).toContain('data: {"a":2}');
  });

  it('emits the return value as event: result when emitResult is true', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ok: true };
    }
    const res = await makeApp((c) =>
      sseGeneratorResponse(c, gen(), { emitResult: true })
    ).request('/x');
    const body = await res.text();
    expect(body).toContain('data: {"a":1}');
    expect(body).toContain('event: result');
    expect(body).toContain('data: {"ok":true}');
  });

  it('omits the return value when emitResult is false', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ignored: true };
    }
    const res = await makeApp((c) =>
      sseGeneratorResponse(c, gen(), { emitResult: false })
    ).request('/x');
    const body = await res.text();
    expect(body).toContain('data: {"a":1}');
    expect(body).not.toContain('event: result');
    expect(body).not.toContain('"ignored"');
  });

  it('frames thrown errors as event: error JSON', async () => {
    async function* gen(): AsyncGenerator<unknown, unknown, unknown> {
      yield { a: 1 };
      throw new Error('bad');
    }
    const res = await makeApp((c) => sseGeneratorResponse(c, gen())).request(
      '/x'
    );
    const body = await res.text();
    expect(body).toContain('data: {"a":1}');
    expect(body).toContain('event: error');
    expect(body).toContain('"message":"bad"');
    expect(body).toContain('"name":"Error"');
  });
});

describe('sseReadableStreamResponse', () => {
  it('frames each enqueued chunk as a data event', async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ tick: 1 });
        controller.enqueue({ tick: 2 });
        controller.close();
      },
    });
    const res = await makeApp((c) =>
      sseReadableStreamResponse(c, source)
    ).request('/x');
    const body = await res.text();
    expect(body).toContain('data: {"tick":1}');
    expect(body).toContain('data: {"tick":2}');
  });
});
