// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __wrapNavigation,
  __wrapRouteCommit,
  __noteLoadStart,
  __subscribePhase,
  resetDefaultTypesForTesting,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { resetHistoryShimForTesting } from '../internal/history-shim.js';

// __wrapNavigation runs an async view-transition callback; `tick` lets it run
// after startViewTransition returns (the browser invokes the callback async, so
// the fake below does too).
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function installFakeVt() {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  let rejectFinished!: (reason?: unknown) => void;
  const finished = new Promise<void>((res, rej) => {
    resolveFinished = res;
    rejectFinished = rej;
  });
  let skipped = false;
  const startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
    // Real browsers run the update callback asynchronously, after capturing the
    // old snapshot; mirror that so the coordinator's `transition` ref is set.
    void Promise.resolve().then(() => cb());
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: { add: (t: string) => typeAdds.push(t) },
      skipTransition: () => {
        skipped = true;
      },
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return {
    startViewTransition,
    typeAdds,
    resolveFinished,
    rejectFinished,
    isSkipped: () => skipped,
  };
}

describe('navigation-wrapping view-transition coordinator', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
    __resetTransitionStateForTesting();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('warm navigation: starts a transition and runs the commit inside it', async () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __wrapNavigation(() => swapped.push('commit'));
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // The navigation commit runs inside the transition callback (so the browser
    // captures the old route first, then the commit swaps in the new one).
    expect(swapped).toEqual(['commit']);
  });

  it('warm navigation: phases fire in order with the nav types', async () => {
    const { typeAdds, resolveFinished } = installFakeVt();
    const phases: string[] = [];
    const subs = (
      [
        'beforeTransition',
        'beforeSwap',
        'afterSwap',
        'afterTransition',
      ] as const
    ).map((p) => __subscribePhase(p, () => phases.push(p)));

    __wrapNavigation(() => {});
    await tick();
    expect(phases).toEqual(['beforeTransition', 'beforeSwap', 'afterSwap']);
    // afterTransition waits for transition.finished.
    resolveFinished();
    await tick();
    expect(phases).toEqual([
      'beforeTransition',
      'beforeSwap',
      'afterSwap',
      'afterTransition',
    ]);
    expect(typeAdds).toContain('nav-same-origin');
    subs.forEach((u) => u());
  });

  it('cold navigation: holds the transition until the content commits', async () => {
    const { startViewTransition } = installFakeVt();
    const order: string[] = [];
    // Simulate the destination route suspending during the commit.
    __noteLoadStart();
    __wrapNavigation(() => order.push('nav-commit'));
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // The nav commit ran, but the transition is now awaiting the content.
    expect(order).toEqual(['nav-commit']);
    // The route's content commits via wrapUpdate, resuming the transition.
    __wrapRouteCommit(() => order.push('content'));
    await tick();
    expect(order).toEqual(['nav-commit', 'content']);
  });

  it('cold navigation: a later (nested) commit applies directly, no extra transition', async () => {
    const { startViewTransition } = installFakeVt();
    const order: string[] = [];
    __noteLoadStart();
    __wrapNavigation(() => order.push('nav'));
    await tick();
    __wrapRouteCommit(() => order.push('shell'));
    await tick();
    __wrapRouteCommit(() => order.push('fill-in'));
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['nav', 'shell', 'fill-in']);
  });

  it('initial route load (no navigation): commit applies directly with no transition', () => {
    const { startViewTransition } = installFakeVt();
    const swapped: string[] = [];
    __wrapRouteCommit(() => swapped.push('home'));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(swapped).toEqual(['home']);
  });

  it('skip(): no transition animation, no beforeSwap, afterTransition reason "skipped"', async () => {
    const { isSkipped, resolveFinished } = installFakeVt();
    const phases: string[] = [];
    const u1 = __subscribePhase('beforeTransition', (e) => e.skip());
    const u2 = __subscribePhase('beforeSwap', () => phases.push('beforeSwap'));
    const u3 = __subscribePhase('afterTransition', (e) =>
      phases.push(`afterTransition:${e.reason}`)
    );

    __wrapNavigation(() => {});
    await tick();
    expect(isSkipped()).toBe(true);
    expect(phases).not.toContain('beforeSwap');
    resolveFinished();
    await tick();
    expect(phases).toContain('afterTransition:skipped');
    u1();
    u2();
    u3();
  });

  it('cold navigation abandoned by a new navigation: the stale transition resumes (no freeze)', async () => {
    const { startViewTransition } = installFakeVt();
    __noteLoadStart();
    __wrapNavigation(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    // A second navigation arrives before the first committed its content. It
    // must resume the first (so its transition can't stay frozen) and start its
    // own.
    __wrapNavigation(() => {});
    await tick();
    expect(startViewTransition).toHaveBeenCalledTimes(2);
  });
});
