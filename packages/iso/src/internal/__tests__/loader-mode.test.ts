import { describe, it, expect } from 'vitest';
import {
  isStreamingMode,
  resolveLoaderMode,
  type AccumulateOptions,
} from '../loader-mode.js';

const ACC: AccumulateOptions = {
  initial: [] as unknown,
  reduce: (acc, chunk) => (acc as unknown[]).concat(chunk),
};

describe('resolveLoaderMode', () => {
  it('collects a streaming loader hosted without an accumulator', () => {
    expect(resolveLoaderMode(undefined, true)).toEqual({ kind: 'collect' });
  });

  it('reads a non-streaming loader hosted without an accumulator as single', () => {
    expect(resolveLoaderMode(undefined, false)).toEqual({ kind: 'single' });
  });

  it('folds a streaming loader hosted with an accumulator, carrying the payload', () => {
    const mode = resolveLoaderMode(ACC, true);
    expect(mode.kind).toBe('fold');
    if (mode.kind !== 'fold') throw new Error('expected fold');
    expect(mode.initial).toEqual([]);
    expect(mode.reduce([1], 2)).toEqual([1, 2]);
  });

  it('folds a NON-streaming loader hosted with an accumulator', () => {
    // The derivation order, pinned. `accumulate` is tested BEFORE `isStreaming`,
    // so this supported host (`LoaderRef<T, false>.Boundary accumulate={...}`)
    // resolves to `fold`. Testing `isStreaming` first would send it to `single`,
    // which flips the SSR projection (a baked `success` LoaderState instead of an
    // unbaked `connecting` StreamState) and the client's first render with it:
    // a hydration mismatch, not a visible failure. `loader-accumulate.test.tsx`
    // pins both halves of that behaviour end to end.
    expect(resolveLoaderMode(ACC, false).kind).toBe('fold');
  });

  it('hands both payload-free modes ONE shared instance, so a host keeps one mode identity', () => {
    // The runner keys `useCallback`s on the mode; a fresh object per resolve
    // would rebuild them on every render of every single/collect host.
    expect(resolveLoaderMode(undefined, false)).toBe(
      resolveLoaderMode(undefined, false)
    );
    expect(resolveLoaderMode(undefined, true)).toBe(
      resolveLoaderMode(undefined, true)
    );
  });
});

describe('isStreamingMode', () => {
  it('is true for both streaming modes and false for single', () => {
    expect(isStreamingMode({ kind: 'single' })).toBe(false);
    expect(isStreamingMode({ kind: 'collect' })).toBe(true);
    expect(isStreamingMode({ kind: 'fold', ...ACC })).toBe(true);
  });
});
