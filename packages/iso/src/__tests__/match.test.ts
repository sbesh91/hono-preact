import { describe, it, expect } from 'vitest';
import { match } from '../loader-state.js';
import type { LoaderState, StreamState } from '../loader-state.js';

describe('match', () => {
  it('dispatches each LoaderState arm to its handler', () => {
    const handlers = {
      loading: () => 'loading',
      success: (s: { status: 'success'; data: number }) => `ok:${s.data}`,
      revalidating: (s: { status: 'revalidating'; data: number }) => `re:${s.data}`,
      error: (s: { status: 'error'; error: Error; data: number }) => `err:${s.error.message}`,
    };
    const loading: LoaderState<number> = { status: 'loading' };
    const success: LoaderState<number> = { status: 'success', data: 7 };
    expect(match(loading, handlers)).toBe('loading');
    expect(match(success, handlers)).toBe('ok:7');
  });

  it('reaches the success arm for a falsy resolved value', () => {
    // The whole point of #371: 0 is a real value, not "still loading".
    const zero: LoaderState<number> = { status: 'success', data: 0 };
    const result = match<LoaderState<number>, string>(zero, {
      loading: () => 'loading',
      success: (s) => `ok:${s.data}`,
      revalidating: (s) => `re:${s.data}`,
      error: (s) => `err:${s.error.message}`,
    });
    expect(result).toBe('ok:0');
  });

  it('dispatches StreamState arms with the same helper', () => {
    const open: StreamState<number[]> = { status: 'open', data: [1, 2] };
    const result = match<StreamState<number[]>, string>(open, {
      connecting: () => 'connecting',
      open: (s) => `open:${s.data.length}`,
      reconnecting: (s) => `re:${s.data.length}`,
      closed: (s) => `closed:${s.data.length}`,
      error: (s) => `err:${s.error.message}`,
    });
    expect(result).toBe('open:2');
  });

  it('falls back to _ for arms not listed', () => {
    const closed: StreamState<number[]> = { status: 'closed', data: [1] };
    const result = match<StreamState<number[]>, string>(closed, {
      open: (s) => `open:${s.data.length}`,
      _: (s) => `other:${s.status}`,
    });
    expect(result).toBe('other:closed');
  });

  it('prefers an explicit handler over _', () => {
    const open: StreamState<number[]> = { status: 'open', data: [9] };
    const result = match<StreamState<number[]>, string>(open, {
      open: (s) => `open:${s.data.length}`,
      _: () => 'fallback',
    });
    expect(result).toBe('open:1');
  });
});
