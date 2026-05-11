import { describe, it, expect } from 'vitest';
import { sseEncode, SSE_KEEPALIVE, sseEncodeError } from '../sse.js';

const decoder = new TextDecoder();

describe('sseEncode', () => {
  it('encodes a default data-only event', () => {
    const out = sseEncode({ data: '{"x":1}' });
    expect(decoder.decode(out)).toBe('data: {"x":1}\n\n');
  });

  it('encodes a named event', () => {
    const out = sseEncode({ event: 'result', data: '{"ok":true}' });
    expect(decoder.decode(out)).toBe('event: result\ndata: {"ok":true}\n\n');
  });
});

describe('SSE_KEEPALIVE', () => {
  it('is an SSE comment line', () => {
    expect(decoder.decode(SSE_KEEPALIVE)).toBe(': keepalive\n\n');
  });
});

describe('sseEncodeError', () => {
  it('encodes an Error as an event: error frame', () => {
    const out = sseEncodeError(new Error('boom'));
    expect(decoder.decode(out)).toBe('event: error\ndata: {"message":"boom","name":"Error"}\n\n');
  });

  it('falls back to String(value) for non-Error values', () => {
    const out = sseEncodeError('plain string');
    expect(decoder.decode(out)).toBe('event: error\ndata: {"message":"plain string","name":"Error"}\n\n');
  });
});

import { sseFromGenerator } from '../sse.js';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe('sseFromGenerator', () => {
  it('emits each yield as a data event', async () => {
    async function* gen() {
      yield { a: 1 };
      yield { a: 2 };
    }
    const body = await readAll(sseFromGenerator(gen(), {}));
    expect(body).toBe('data: {"a":1}\n\ndata: {"a":2}\n\n');
  });

  it('emits the return value as event: result when emitResult is true', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ok: true };
    }
    const body = await readAll(sseFromGenerator(gen(), { emitResult: true }));
    expect(body).toBe('data: {"a":1}\n\nevent: result\ndata: {"ok":true}\n\n');
  });

  it('omits the return value when emitResult is false', async () => {
    async function* gen() {
      yield { a: 1 };
      return { ignored: true };
    }
    const body = await readAll(sseFromGenerator(gen(), { emitResult: false }));
    expect(body).toBe('data: {"a":1}\n\n');
  });

  it('emits event: error when the generator throws', async () => {
    async function* gen(): AsyncGenerator<unknown, unknown, unknown> {
      yield { a: 1 };
      throw new Error('bad');
    }
    const body = await readAll(sseFromGenerator(gen(), {}));
    expect(body).toBe(
      'data: {"a":1}\n\nevent: error\ndata: {"message":"bad","name":"Error"}\n\n'
    );
  });

  it('closes the stream early when the abort signal fires', async () => {
    const ac = new AbortController();
    let cancelled = false;
    async function* gen() {
      try {
        yield 1;
        await new Promise((r) => setTimeout(r, 50));
        yield 2;
      } finally {
        cancelled = true;
      }
    }
    const stream = sseFromGenerator(gen(), { signal: ac.signal });
    const reader = stream.getReader();
    await reader.read();
    ac.abort();
    while (!(await reader.read()).done) { /* drain */ }
    expect(cancelled).toBe(true);
  });
});
