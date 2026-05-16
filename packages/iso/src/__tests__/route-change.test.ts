// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import {
  __dispatchRouteChange,
  __subscribeRouteChange,
  __enableViewTransitions,
} from '../internal/route-change.js';
import { useRouteChange } from '../route-change.js';

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a disabler function', () => {
    const disable = __enableViewTransitions();
    expect(typeof disable).toBe('function');
    disable();
  });

  it('wraps a same-origin link click in startViewTransition when enabled', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    const disable = __enableViewTransitions();

    const link = document.createElement('a');
    link.href = location.origin + '/foo';
    document.body.appendChild(link);
    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    document.body.removeChild(link);
    disable();
  });

  it('does not wrap clicks once no enabler is active', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    const link = document.createElement('a');
    link.href = location.origin + '/foo';
    document.body.appendChild(link);
    link.click();
    expect(startViewTransition).not.toHaveBeenCalled();

    document.body.removeChild(link);
  });

  it('keeps the click interceptor active until the last enabler is disabled', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    const d1 = __enableViewTransitions();
    const d2 = __enableViewTransitions();

    const link = document.createElement('a');
    link.href = location.origin + '/foo';
    document.body.appendChild(link);

    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    d1();
    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(2); // still enabled by d2

    d2();
    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(2); // fully disabled, no extra

    document.body.removeChild(link);
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

describe('useRouteChange', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const calls: Array<[string, string | undefined]> = [];
    const handler = (to: string, from: string | undefined) => {
      calls.push([to, from]);
    };

    const { unmount } = renderHook(() => useRouteChange(handler));

    __dispatchRouteChange('/a', undefined);
    expect(calls).toEqual([['/a', undefined]]);

    unmount();

    __dispatchRouteChange('/b', '/a');
    expect(calls).toEqual([['/a', undefined]]); // no call after unmount
  });

  it('uses the latest handler reference (re-subscribes on handler change)', () => {
    const callsA: string[] = [];
    const callsB: string[] = [];
    const handlerA = (to: string) => callsA.push(to);
    const handlerB = (to: string) => callsB.push(to);

    const { rerender } = renderHook(({ h }: { h: (to: string) => void }) => useRouteChange(h), {
      initialProps: { h: handlerA },
    });

    __dispatchRouteChange('/x', undefined);
    expect(callsA).toEqual(['/x']);
    expect(callsB).toEqual([]);

    rerender({ h: handlerB });

    __dispatchRouteChange('/y', '/x');
    expect(callsA).toEqual(['/x']);
    expect(callsB).toEqual(['/y']);
  });
});
