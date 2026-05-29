// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useViewTransitionLifecycle } from '../view-transition-lifecycle.js';
import { __dispatchRouteChange } from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

type SavedSVT = typeof document.startViewTransition | undefined;
let savedSVT: SavedSVT;

function installFakeVt() {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const startViewTransition = vi.fn((cb: () => void) => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
    };
  });
  document.startViewTransition = startViewTransition as never;
  return { resolveFinished };
}

describe('useViewTransitionLifecycle', () => {
  beforeEach(() => {
    savedSVT = document.startViewTransition;
    resetHistoryShimForTesting();
  });

  afterEach(() => {
    if (savedSVT === undefined) {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    } else {
      document.startViewTransition = savedSVT;
    }
  });

  it('fires all four phase callbacks for one navigation', async () => {
    const { resolveFinished } = installFakeVt();
    const calls: string[] = [];

    const { unmount } = renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: () => calls.push('beforeTransition'),
        onBeforeSwap: () => calls.push('beforeSwap'),
        onAfterSwap: () => calls.push('afterSwap'),
        onAfterTransition: () => calls.push('afterTransition'),
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([
      'beforeTransition',
      'beforeSwap',
      'afterSwap',
      'afterTransition',
    ]);
    unmount();
  });

  it('unsubscribes on unmount', async () => {
    installFakeVt();
    const calls: string[] = [];
    const { unmount } = renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: () => calls.push('hit'),
      })
    );

    __dispatchRouteChange('/a', undefined);
    expect(calls).toEqual(['hit']);

    unmount();
    __dispatchRouteChange('/b', '/a');
    expect(calls).toEqual(['hit']);
  });

  it('uses the latest callback reference (no churn on rerender)', () => {
    installFakeVt();
    const calls: string[] = [];
    const cbA = () => calls.push('A');
    const cbB = () => calls.push('B');

    const { rerender, unmount } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useViewTransitionLifecycle({ onBeforeTransition: cb }),
      { initialProps: { cb: cbA } }
    );

    __dispatchRouteChange('/x', undefined);
    rerender({ cb: cbB });
    __dispatchRouteChange('/y', '/x');

    expect(calls).toEqual(['A', 'B']);
    unmount();
  });

  it('skip() in onBeforeTransition bypasses startViewTransition', async () => {
    const { resolveFinished } = installFakeVt();
    let reason: string | undefined;
    const { unmount } = renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeTransition: (e) => e.skip(),
        onBeforeSwap: () => {
          throw new Error('should not fire');
        },
        onAfterTransition: (e) => {
          reason = e.reason;
        },
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(reason).toBe('skipped');
    unmount();
  });

  it('stash via event.set/get carries data across phases', async () => {
    const { resolveFinished } = installFakeVt();
    const KEY = Symbol('scroll');
    let observed: number | undefined;
    const { unmount } = renderHook(() =>
      useViewTransitionLifecycle({
        onBeforeSwap: (e) => e.set(KEY, 42),
        onAfterSwap: (e) => {
          observed = e.get<number>(KEY);
        },
      })
    );

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(observed).toBe(42);
    unmount();
  });
});
