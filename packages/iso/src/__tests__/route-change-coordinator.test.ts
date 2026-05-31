// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __wrapRouteCommit,
  __noteLoadStart,
  __noteLoadEnd,
  __subscribePhase,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

function installFakeVt() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));
  const startViewTransition = vi.fn((cb: () => void) => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: { add: (t: string) => typeAdds.push(t) },
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition, typeAdds, resolveFinished };
}

describe('defer-aware transition coordinator', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('warm nav (depth 0): transition runs at dispatch', () => {
    const { startViewTransition } = installFakeVt();
    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('cold nav: dispatch starts nothing; first commit runs the single transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).not.toHaveBeenCalled();
    __wrapRouteCommit(() => swapped.push('content'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(swapped).toEqual(['content']);
  });

  it('cold nav: post-swap phases fire against the deferred transition with the nav types', () => {
    const { typeAdds } = installFakeVt();
    const phases: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () =>
      phases.push('beforeTransition')
    );
    const u2 = __subscribePhase('beforeSwap', () => phases.push('beforeSwap'));
    const u3 = __subscribePhase('afterSwap', () => phases.push('afterSwap'));
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    expect(phases).toEqual(['beforeTransition']);
    __wrapRouteCommit(() => {});
    expect(phases).toEqual(['beforeTransition', 'beforeSwap', 'afterSwap']);
    expect(typeAdds).toContain('nav-same-origin');
    u1();
    u2();
    u3();
  });

  it('nested cold nav: one transition, the second commit runs directly', () => {
    const { startViewTransition } = installFakeVt();
    const order: string[] = [];
    __noteLoadStart();
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    __wrapRouteCommit(() => order.push('outer'));
    __wrapRouteCommit(() => order.push('inner'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['outer', 'inner']);
  });

  it('initial load (no dispatch): commit runs directly with no transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __wrapRouteCommit(() => swapped.push('home'));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(swapped).toEqual(['home']);
  });
});
