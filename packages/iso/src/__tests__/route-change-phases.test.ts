// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __subscribePhase,
  resetDefaultTypesForTesting,
} from '../internal/route-change.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';
import type { ViewTransitionEvent } from '../internal/view-transition-event.js';

interface FakeViewTransition {
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
  types?: { add(t: string): void };
}

function installFakeVt(
  opts: {
    withTypes?: boolean;
    failedFinish?: boolean;
  } = {}
): {
  startViewTransition: ReturnType<typeof vi.fn>;
  typeAdds: string[];
  resolveFinished: () => void;
  rejectFinished: (err: unknown) => void;
} {
  const typeAdds: string[] = [];
  let resolveFinished!: () => void;
  let rejectFinished!: (err: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const startViewTransition = vi.fn((cb: () => void): FakeViewTransition => {
    cb();
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      ...(opts.withTypes
        ? { types: { add: (t: string) => typeAdds.push(t) } }
        : {}),
    };
  });
  vi.stubGlobal('document', { startViewTransition });
  return { startViewTransition, typeAdds, resolveFinished, rejectFinished };
}

describe('__dispatchRouteChange phase dispatcher', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryShimForTesting();
    resetDefaultTypesForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('walks phases in order: beforeTransition, beforeSwap, afterSwap, afterTransition', async () => {
    const { resolveFinished } = installFakeVt();
    const calls: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () =>
      calls.push('beforeTransition')
    );
    const u2 = __subscribePhase('beforeSwap', () => calls.push('beforeSwap'));
    const u3 = __subscribePhase('afterSwap', () => calls.push('afterSwap'));
    const u4 = __subscribePhase('afterTransition', () =>
      calls.push('afterTransition')
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
    u1();
    u2();
    u3();
    u4();
  });

  it('fires multiple subscribers in registration order within a phase', async () => {
    const { resolveFinished } = installFakeVt();
    const order: string[] = [];
    const u1 = __subscribePhase('beforeTransition', () => order.push('one'));
    const u2 = __subscribePhase('beforeTransition', () => order.push('two'));

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(order).toEqual(['one', 'two']);
    u1();
    u2();
  });

  it('skip() in beforeTransition bypasses startViewTransition and fires afterTransition with reason "skipped"', async () => {
    const { startViewTransition } = installFakeVt();
    let observedReason: string | undefined;
    const u1 = __subscribePhase('beforeTransition', (e) => e.skip());
    const u2 = __subscribePhase('beforeSwap', () => {
      throw new Error('should not fire on skip');
    });
    const u3 = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    await Promise.resolve();

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(observedReason).toBe('skipped');
    u1();
    u2();
    u3();
  });

  it('fires afterTransition with reason "unsupported" when document.startViewTransition is missing', async () => {
    vi.stubGlobal('document', {});
    let observedReason: string | undefined;
    const u = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    await Promise.resolve();

    expect(observedReason).toBe('unsupported');
    u();
  });

  it('applies event.types via viewTransition.types.add when supported', async () => {
    const { typeAdds, resolveFinished } = installFakeVt({ withTypes: true });
    const u = __subscribePhase('beforeTransition', (e) => {
      e.types.push('custom-a');
      e.types.push('custom-b');
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(typeAdds).toEqual(expect.arrayContaining(['custom-a', 'custom-b']));
    u();
  });

  it('no-ops the types path when viewTransition.types is absent (older browsers)', async () => {
    const { resolveFinished } = installFakeVt({ withTypes: false });
    const u = __subscribePhase('beforeTransition', (e) => {
      e.types.push('would-not-apply');
    });

    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    resolveFinished();
    await Promise.resolve();
    u();
  });

  it('sets event.transition only from beforeSwap onward', async () => {
    const { resolveFinished } = installFakeVt();
    let transitionAtBeforeTransition: ViewTransition | null | undefined;
    let transitionAtBeforeSwap: ViewTransition | null | undefined;
    let transitionAtAfterTransition: ViewTransition | null | undefined;
    const u1 = __subscribePhase('beforeTransition', (e) => {
      transitionAtBeforeTransition = e.transition;
    });
    const u2 = __subscribePhase('beforeSwap', (e) => {
      transitionAtBeforeSwap = e.transition;
    });
    const u3 = __subscribePhase('afterTransition', (e) => {
      transitionAtAfterTransition = e.transition;
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(transitionAtBeforeTransition).toBeNull();
    expect(transitionAtBeforeSwap).not.toBeNull();
    expect(transitionAtAfterTransition).not.toBeNull();
    u1();
    u2();
    u3();
  });

  it('shares the event instance across all phases (stash continuity)', async () => {
    const { resolveFinished } = installFakeVt();
    const KEY = Symbol('cross-phase');
    let observed: number | undefined;
    const u1 = __subscribePhase('beforeTransition', (e) => {
      e.set(KEY, 42);
    });
    const u2 = __subscribePhase('afterTransition', (e) => {
      observed = e.get<number>(KEY);
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();

    expect(observed).toBe(42);
    u1();
    u2();
  });

  it('fires afterTransition with reason "aborted" when transition.finished rejects', async () => {
    const { rejectFinished } = installFakeVt();
    let observedReason: string | undefined;
    const u = __subscribePhase('afterTransition', (e) => {
      observedReason = e.reason;
    });

    __dispatchRouteChange('/a', undefined);
    rejectFinished(new Error('user navigation interrupted'));
    await Promise.resolve();
    await Promise.resolve();

    expect(observedReason).toBe('aborted');
    u();
  });

  it('passes the current direction from the history shim into the event', async () => {
    const { resolveFinished } = installFakeVt();
    setNavDirectionForTesting('back');
    let observed: string | undefined;
    const u = __subscribePhase('beforeTransition', (e) => {
      observed = e.direction;
    });

    __dispatchRouteChange('/a', undefined);
    resolveFinished();
    await Promise.resolve();

    expect(observed).toBe('back');
    u();
  });
});
