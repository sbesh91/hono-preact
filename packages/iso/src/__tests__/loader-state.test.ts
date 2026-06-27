import { describe, it, expect } from 'vitest';
import { toLoaderView, toStreamState } from '../loader-state.js';

describe('toLoaderView', () => {
  const e = new Error('boom');
  // Structural projection: dispatch on the phase variant tag + the `sync.present`
  // flag. NEVER on `data === undefined` / `value !== undefined`.
  it('loading phase, no sync value -> loading', () => {
    expect(toLoaderView({ tag: 'loading' }, { present: false })).toEqual({
      kind: 'render',
      state: { status: 'loading' },
    });
  });
  it('loading phase with a synchronously-adopted (preload/cache) value -> success', () => {
    expect(
      toLoaderView({ tag: 'loading' }, { present: true, value: { a: 1 } })
    ).toEqual({
      kind: 'render',
      state: { status: 'success', data: { a: 1 } },
    });
  });
  it('success phase -> success', () => {
    expect(
      toLoaderView({ tag: 'success', value: { a: 1 } }, { present: false })
    ).toEqual({
      kind: 'render',
      state: { status: 'success', data: { a: 1 } },
    });
  });
  it('success phase whose value is undefined -> success(undefined), not loading', () => {
    // A loader that legitimately resolves to `undefined` is a value-bearing
    // phase, so it projects to `success` (data === undefined). This is the core
    // regression the old `data === undefined -> loading` heuristic hit.
    expect(
      toLoaderView({ tag: 'success', value: undefined }, { present: false })
    ).toEqual({
      kind: 'render',
      state: { status: 'success', data: undefined },
    });
  });
  it('revalidating phase -> revalidating (keeps the prior value)', () => {
    expect(
      toLoaderView({ tag: 'revalidating', value: { a: 1 } }, { present: false })
    ).toEqual({
      kind: 'render',
      state: { status: 'revalidating', data: { a: 1 } },
    });
  });
  it('staleError phase -> error arm WITH the prior value (stale-while-error)', () => {
    expect(
      toLoaderView(
        { tag: 'staleError', error: e, value: { a: 1 } },
        { present: false }
      )
    ).toEqual({
      kind: 'render',
      state: { status: 'error', error: e, data: { a: 1 } },
    });
  });
  it('cold error phase -> coldError signal (routed to the boundary, not rendered)', () => {
    expect(
      toLoaderView({ tag: 'error', error: e }, { present: false })
    ).toEqual({ kind: 'coldError', error: e });
  });
});

describe('toStreamState', () => {
  const e = new Error('boom');
  it('connecting -> connecting (value ignored)', () => {
    expect(toStreamState('connecting', { present: false }, null)).toEqual({
      status: 'connecting',
    });
    expect(
      toStreamState('connecting', { present: true, value: [] }, null)
    ).toEqual({ status: 'connecting' });
  });
  it('open carries data, including a legitimately undefined accumulator (NOT connecting)', () => {
    expect(toStreamState('open', { present: true, value: [1] }, null)).toEqual({
      status: 'open',
      data: [1],
    });
    // The `stream` finding: keyed on STATUS only, so an `undefined` accumulator
    // on an open stream is `open` with `data: undefined`, not stuck connecting.
    expect(
      toStreamState('open', { present: true, value: undefined }, null)
    ).toEqual({ status: 'open', data: undefined });
  });
  it('closed carries data, including an undefined accumulator', () => {
    expect(
      toStreamState('closed', { present: true, value: [1] }, null)
    ).toEqual({ status: 'closed', data: [1] });
    expect(
      toStreamState('closed', { present: true, value: undefined }, null)
    ).toEqual({ status: 'closed', data: undefined });
  });
  it('post-chunk error keeps the last-good data', () => {
    expect(toStreamState('error', { present: true, value: [1] }, e)).toEqual({
      status: 'error',
      error: e,
      data: [1],
    });
  });
  it('cold error (no accumulated value yet) -> error arm without data', () => {
    expect(toStreamState('error', { present: false }, e)).toEqual({
      status: 'error',
      error: e,
    });
  });
});
