import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  sseGeneratorResponse,
  sseReadableStreamResponse,
} from '../sse.js';

async function bodyToString(res: Response): Promise<string> {
  return res.body ? new TextDecoder().decode(await new Response(res.body).arrayBuffer()) : '';
}

describe('SSE wire format', () => {
  it('generator response: byte-stable for a representative stream', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(
        c,
        (async function* () {
          yield 'first';
          yield { n: 2 };
          return 'final';
        })(),
        { emitResult: true }
      )
    );

    const res = await app.request('http://localhost/');
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = await bodyToString(res);
    expect(body).toBe(
      'data: "first"\n\n' +
        'data: {"n":2}\n\n' +
        'event: result\ndata: "final"\n\n'
    );
  });

  it('readable-stream response: byte-stable for a representative stream', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      const source = new ReadableStream<unknown>({
        start(controller) {
          controller.enqueue('alpha');
          controller.enqueue({ k: 'beta' });
          controller.close();
        },
      });
      return sseReadableStreamResponse(c, source);
    });

    const res = await app.request('http://localhost/');
    const body = await bodyToString(res);
    expect(body).toBe('data: "alpha"\n\n' + 'data: {"k":"beta"}\n\n');
  });

  it('generator error path: emits event: error frame', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      sseGeneratorResponse(
        c,
        (async function* () {
          yield 'before';
          throw new Error('boom');
        })()
      )
    );

    const res = await app.request('http://localhost/');
    const body = await bodyToString(res);
    expect(body).toBe(
      'data: "before"\n\n' +
        'event: error\ndata: {"message":"boom","name":"Error"}\n\n'
    );
  });
});
