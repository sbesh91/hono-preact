import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __dispatchRouteChange,
  __subscribeRouteChange,
  __enableViewTransitions,
} from '../internal/route-change.js';

describe('__subscribeRouteChange', () => {
  it('invokes the subscriber with (to, from) on dispatch', () => {
    const calls: Array<[string, string | undefined]> = [];
    const unsubscribe = __subscribeRouteChange((to, from) => {
      calls.push([to, from]);
    });

    __dispatchRouteChange('/a', undefined);
    __dispatchRouteChange('/b', '/a');

    expect(calls).toEqual([
      ['/a', undefined],
      ['/b', '/a'],
    ]);
    unsubscribe();
  });

  it('returns a function that unsubscribes', () => {
    const calls: string[] = [];
    const unsubscribe = __subscribeRouteChange((to) => calls.push(to));

    __dispatchRouteChange('/a', undefined);
    unsubscribe();
    __dispatchRouteChange('/b', '/a');

    expect(calls).toEqual(['/a']);
  });

  it('supports multiple subscribers in registration order', () => {
    const order: string[] = [];
    const u1 = __subscribeRouteChange(() => order.push('one'));
    const u2 = __subscribeRouteChange(() => order.push('two'));

    __dispatchRouteChange('/x', undefined);

    expect(order).toEqual(['one', 'two']);
    u1();
    u2();
  });
});

describe('__enableViewTransitions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a disabler function', () => {
    const disable = __enableViewTransitions();
    expect(typeof disable).toBe('function');
    disable();
  });

  it('triggers document.startViewTransition on dispatch when enabled', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    vi.stubGlobal('document', { startViewTransition });

    const disable = __enableViewTransitions();
    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    disable();
  });

  it('does not trigger when no enabler is active', () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal('document', { startViewTransition });

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('only triggers once per dispatch even when enabled multiple times', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    vi.stubGlobal('document', { startViewTransition });

    const d1 = __enableViewTransitions();
    const d2 = __enableViewTransitions();

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    d1();
    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(2); // still enabled by d2

    d2();
    __dispatchRouteChange('/c', '/b');
    expect(startViewTransition).toHaveBeenCalledTimes(2); // disabled, no extra
  });

  it('no-ops when document.startViewTransition is unavailable', () => {
    vi.stubGlobal('document', {});
    const disable = __enableViewTransitions();
    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    disable();
  });

  it('no-ops in a non-browser environment (no document at all)', () => {
    vi.stubGlobal('document', undefined);
    const disable = __enableViewTransitions();
    expect(() => __dispatchRouteChange('/a', undefined)).not.toThrow();
    disable();
  });
});
