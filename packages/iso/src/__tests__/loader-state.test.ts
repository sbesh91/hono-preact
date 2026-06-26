import { describe, it, expect } from 'vitest';
import { toLoaderState, toStreamState } from '../loader-state.js';

describe('toLoaderState', () => {
  const e = new Error('boom');
  it('cold load -> loading', () => {
    expect(toLoaderState(undefined, true, null)).toEqual({ status: 'loading' });
  });
  it('settled value -> success', () => {
    expect(toLoaderState({ a: 1 }, false, null)).toEqual({
      status: 'success',
      data: { a: 1 },
    });
  });
  it('reload with prior data -> revalidating', () => {
    expect(toLoaderState({ a: 1 }, true, null)).toEqual({
      status: 'revalidating',
      data: { a: 1 },
    });
  });
  it('error with prior data -> error (stale-while-error)', () => {
    expect(toLoaderState({ a: 1 }, false, e)).toEqual({
      status: 'error',
      error: e,
      data: { a: 1 },
    });
  });
  it('data===undefined projects to loading at this seam', () => {
    // The pure projection cannot distinguish "cold, no value" from "resolved to
    // undefined"; both have data===undefined, so both map to `loading` here.
    // The resolved-to-undefined-is-success case is a RUNNER concern (the phase
    // ADT carries `{ tag: 'success', value: undefined }`), asserted in Task 5,
    // not at this projection seam.
    expect(toLoaderState(undefined, false, null)).toEqual({
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
