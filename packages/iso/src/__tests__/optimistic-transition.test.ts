// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

// A synchronous stand-in for the real API: runs the update callback inline and
// hands back a settled `ViewTransition`, so `useOptimistic`'s transition branch
// completes within the surrounding `act()`.
function makeSvtSpy() {
  return vi.fn((cb: () => void): ViewTransition => {
    cb();
    return {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      types: new Set<string>(),
      skipTransition: () => {},
    };
  });
}

describe('useOptimistic transition option', () => {
  // happy-dom implements no View Transitions API, so this is `undefined` in
  // practice; captured and restored anyway so the suite does not depend on that.
  let originalSVT: Document['startViewTransition'] | undefined;

  beforeEach(() => {
    originalSVT = document.startViewTransition;
  });
  afterEach(() => {
    if (originalSVT === undefined) {
      Reflect.deleteProperty(document, 'startViewTransition');
    } else {
      document.startViewTransition = originalSVT;
    }
  });

  it('does not wrap settle/revert when transition is omitted (default)', () => {
    const spy = makeSvtSpy();
    document.startViewTransition = spy;

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
    const spy = makeSvtSpy();
    document.startViewTransition = spy;

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
    Reflect.deleteProperty(document, 'startViewTransition');
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
    expect(result.current[0].value).toBe(5);
  });
});
