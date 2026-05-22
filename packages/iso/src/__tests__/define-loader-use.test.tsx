import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineLoader(use)', () => {
  it('accepts middleware on a non-streaming loader', () => {
    const mw = defineServerMiddleware<'loader'>(async (_ctx, next) => {
      await next();
    });
    const ref = defineLoader(async () => ({ items: [1, 2] }), { use: [mw] });
    expect(ref.fn).toBeDefined();
    expect(ref.use).toEqual([mw]);
  });

  it('accepts a stream observer on a streaming loader', () => {
    const obs = defineStreamObserver<number>({ onChunk: () => {} });
    const ref = defineLoader<number>(
      async function* () {
        yield 1;
        yield 2;
      },
      { use: [obs] }
    );
    expect(ref.fn).toBeDefined();
    expect(ref.use).toEqual([obs]);
  });

  it('use defaults to an empty array when omitted', () => {
    const ref = defineLoader(async () => 'x');
    expect(ref.use).toEqual([]);
  });
});
