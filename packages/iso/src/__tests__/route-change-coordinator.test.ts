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

// The cold path starts an async view-transition callback; `tick` lets its
// post-await body run after the bridging commit resolves it.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

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

  it('cold nav: dispatch starts the transition; the content commit drives the swap', async () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    // The transition starts at dispatch so the browser captures the still-mounted
    // source route as the old snapshot; the swap is bridged to the content commit.
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(swapped).toEqual([]);
    __wrapRouteCommit(() => swapped.push('content'));
    await tick();
    expect(swapped).toEqual(['content']);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('cold nav: post-swap phases fire against the transition with the nav types', async () => {
    const { typeAdds } = installFakeVt();
    const phases: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () =>
      phases.push('beforeTransition')
    );
    const u2 = __subscribePhase('beforeSwap', () => phases.push('beforeSwap'));
    const u3 = __subscribePhase('afterSwap', () => phases.push('afterSwap'));
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    // beforeTransition and the nav types are applied at dispatch; the swap phases
    // wait for the content commit.
    expect(phases).toEqual(['beforeTransition']);
    expect(typeAdds).toContain('nav-same-origin');
    __wrapRouteCommit(() => {});
    await tick();
    expect(phases).toEqual(['beforeTransition', 'beforeSwap', 'afterSwap']);
    u1();
    u2();
    u3();
  });

  it('nested cold nav: one transition, the second commit runs directly', async () => {
    const { startViewTransition } = installFakeVt();
    const order: string[] = [];
    __noteLoadStart();
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // First commit drives the single transition's swap; later (nested) commits
    // apply directly.
    __wrapRouteCommit(() => order.push('outer'));
    await tick();
    __wrapRouteCommit(() => order.push('inner'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['outer', 'inner']);
  });

  it('cold nav abandoned by a new navigation: the stale transition resumes (no freeze)', async () => {
    const { startViewTransition } = installFakeVt();
    __noteLoadStart();
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // A second navigation arrives before the first committed. It must resume the
    // first (so its transition can't stay frozen) and start its own.
    __dispatchRouteChange('/c', '/b');
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(2);
  });

  it('initial load (no dispatch): commit runs directly with no transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __wrapRouteCommit(() => swapped.push('home'));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(swapped).toEqual(['home']);
  });
});
