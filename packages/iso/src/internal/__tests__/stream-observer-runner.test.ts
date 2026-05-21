import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from '../stream-observer-runner.js';
import { defineStreamObserver } from '../../define-stream-observer.js';
import type { ServerLoaderCtx } from '../../define-middleware.js';

const fakeC = {} as Context;
const fakeCtx: ServerLoaderCtx = {
  scope: 'loader',
  c: fakeC,
  signal: new AbortController().signal,
  location: { path: '/' } as never,
  module: 'm',
  loader: 'l',
};

describe('stream-observer-runner — lifecycle fanout', () => {
  it('fanStart calls onStart on every observer with the ctx', () => {
    const onStartA = vi.fn();
    const onStartB = vi.fn();
    const obsA = defineStreamObserver({ onStart: onStartA });
    const obsB = defineStreamObserver({ onStart: onStartB });

    fanStart([obsA, obsB], fakeCtx);

    expect(onStartA).toHaveBeenCalledWith(fakeCtx);
    expect(onStartB).toHaveBeenCalledWith(fakeCtx);
  });

  it('fanChunk passes chunk and index to each onChunk', () => {
    const onChunk = vi.fn();
    const obs = defineStreamObserver({ onChunk });
    fanChunk([obs], fakeCtx, 'chunk-0', 0);
    fanChunk([obs], fakeCtx, 'chunk-1', 1);
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, fakeCtx, 'chunk-0', 0);
    expect(onChunk).toHaveBeenNthCalledWith(2, fakeCtx, 'chunk-1', 1);
  });

  it('fanEnd, fanError, fanAbort fire their respective hooks', () => {
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onAbort = vi.fn();
    const obs = defineStreamObserver({ onEnd, onError, onAbort });

    fanEnd([obs], fakeCtx, { chunks: 3, result: undefined });
    fanError([obs], fakeCtx, new Error('boom'), { chunks: 1 });
    fanAbort([obs], fakeCtx, { chunks: 2 });

    expect(onEnd).toHaveBeenCalledWith(fakeCtx, {
      chunks: 3,
      result: undefined,
    });
    expect(onError).toHaveBeenCalledWith(fakeCtx, expect.any(Error), {
      chunks: 1,
    });
    expect(onAbort).toHaveBeenCalledWith(fakeCtx, { chunks: 2 });
  });
});

describe('stream-observer-runner — failure isolation', () => {
  it('an observer that throws does not prevent subsequent observers from being called', () => {
    const onChunkA = vi.fn(() => {
      throw new Error('a-broke');
    });
    const onChunkB = vi.fn();
    const obsA = defineStreamObserver({ onChunk: onChunkA });
    const obsB = defineStreamObserver({ onChunk: onChunkB });

    // Silence the expected console.error from the isolation handler.
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    fanChunk([obsA, obsB], fakeCtx, 'x', 0);
    consoleSpy.mockRestore();

    expect(onChunkA).toHaveBeenCalled();
    expect(onChunkB).toHaveBeenCalledWith(fakeCtx, 'x', 0);
  });

  it('observer errors are swallowed, not rethrown to the caller', () => {
    const obs = defineStreamObserver({
      onStart: () => {
        throw new Error('observer-broke');
      },
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(() => fanStart([obs], fakeCtx)).not.toThrow();
    consoleSpy.mockRestore();
  });
});
