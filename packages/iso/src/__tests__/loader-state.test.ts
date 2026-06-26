import { describe, it, expect } from 'vitest';
import { toLoaderState, toStreamState } from '../loader-state.js';

describe('toLoaderState', () => {
  const e = new Error('boom');
  // Signature: toLoaderState(data, error, settled, reloading). Projection is
  // keyed on the authoritative `settled` discriminant, never on
  // `data === undefined`.
  it('not settled -> loading', () => {
    expect(toLoaderState(undefined, null, false, false)).toEqual({
      status: 'loading',
    });
  });
  it('settled value -> success', () => {
    expect(toLoaderState({ a: 1 }, null, true, false)).toEqual({
      status: 'success',
      data: { a: 1 },
    });
  });
  it('settled + reloading -> revalidating (keeps prior data)', () => {
    expect(toLoaderState({ a: 1 }, null, true, true)).toEqual({
      status: 'revalidating',
      data: { a: 1 },
    });
  });
  it('settled + error -> error (stale-while-error)', () => {
    expect(toLoaderState({ a: 1 }, e, true, false)).toEqual({
      status: 'error',
      error: e,
      data: { a: 1 },
    });
  });
  it('settled value of undefined -> success with data undefined (review #1)', () => {
    // A loader that legitimately resolves to `undefined` is SETTLED, so it
    // projects to `success` (data === undefined), NOT back to `loading`. This is
    // the core regression the old `data === undefined -> loading` heuristic hit.
    expect(toLoaderState(undefined, null, true, false)).toEqual({
      status: 'success',
      data: undefined,
    });
  });
  it('error but not settled -> loading (cold error routed to the boundary)', () => {
    // A cold error (no settled value) projects to `loading` here; `loader.tsx`
    // routes it to `errorFallback`/the boundary before the render fn runs.
    expect(toLoaderState(undefined, e, false, false)).toEqual({
      status: 'loading',
    });
  });
});

describe('toStreamState', () => {
  const e = new Error('boom');
  it('no data -> connecting', () => {
    expect(toStreamState(undefined, 'connecting', null)).toEqual({
      status: 'connecting',
    });
    expect(toStreamState(undefined, 'open', null)).toEqual({
      status: 'connecting',
    });
  });
  it('reload with seed (connecting status, defined initial) -> connecting', () => {
    // A live-loader reload surfaces data = accumulate.initial (e.g. []) with
    // status 'connecting' before the first chunk re-arrives; project that as
    // connecting (mirroring a fresh mount), not open with the empty seed.
    expect(toStreamState([], 'connecting', null)).toEqual({
      status: 'connecting',
    });
  });
  it('open with data', () => {
    expect(toStreamState([1], 'open', null)).toEqual({
      status: 'open',
      data: [1],
    });
  });
  it('closed with data', () => {
    expect(toStreamState([1], 'closed', null)).toEqual({
      status: 'closed',
      data: [1],
    });
  });
  it('error with data', () => {
    expect(toStreamState([1], 'error', e)).toEqual({
      status: 'error',
      error: e,
      data: [1],
    });
  });
});
