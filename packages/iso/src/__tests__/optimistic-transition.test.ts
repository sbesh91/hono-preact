// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

declare global {
  interface Document {
    startViewTransition?: (cb: () => void) => {
      finished: Promise<void>;
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
    };
  }
}

describe('useOptimistic transition option', () => {
  let originalSVT: typeof document.startViewTransition | undefined;

  beforeEach(() => {
    originalSVT = document.startViewTransition;
  });
  afterEach(() => {
    if (originalSVT === undefined) {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    } else {
      document.startViewTransition = originalSVT;
    }
  });

  it('does not wrap settle/revert when transition is omitted (default)', () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    document.startViewTransition = spy as never;

    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p)
    );
    let handle!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    act(() => handle.settle());
    act(() => {
      result.current[1](2).revert();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('wraps settle and revert when transition is true, but not the initial mutate', () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    document.startViewTransition = spy as never;

    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p, {
        transition: true,
      })
    );
    let handle!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    // mutate path: no transition
    expect(spy).not.toHaveBeenCalled();
    act(() => handle.settle());
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => {
      const handle2 = result.current[1](3);
      handle2.revert();
    });
    // mutate (no), revert (yes) => one more call
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('no-ops gracefully when startViewTransition is unavailable', () => {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    const { result } = renderHook(() =>
      useOptimistic<number, number>(0, (acc, p) => acc + p, {
        transition: true,
      })
    );
    let handle!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      handle = result.current[1](5);
    });
    act(() => handle.settle());
    expect(result.current[0]).toBe(5);
  });
});
