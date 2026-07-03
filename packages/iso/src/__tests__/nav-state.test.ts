import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeRouterLoadTracker,
  getNavPending,
  subscribeNavState,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('nav-pending notify layer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetTransitionStateForTesting();
  });
  afterEach(() => {
    __resetTransitionStateForTesting();
    vi.useRealTimers();
  });

  it('getNavPending reflects the set after the reconcile microtask', async () => {
    expect(getNavPending()).toBe(false);
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('notifies subscribers on the false->true and true->false transitions', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    expect(seen).toEqual([true]);
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([true, false]);
    off();
  });

  it('coalesces synchronous churn: two starts in one tick emit one notification', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([true]);
  });

  it('emits nothing when a burst nets to no pending change (start+end same tick)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([]);
  });

  it('a guarded Router (double onLoadStart, single onLoadEnd) ends pending=false', async () => {
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('nested Routers: both must end before pending is false', async () => {
    const outer = makeRouterLoadTracker();
    const inner = makeRouterLoadTracker();
    outer.onLoadStart();
    inner.onLoadStart();
    await flush();
    expect(getNavPending()).toBe(true);
    outer.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(true);
    inner.onLoadEnd();
    await flush();
    expect(getNavPending()).toBe(false);
  });

  it('isolates a throwing listener so other subscribers still receive the change', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    subscribeNavState(() => {
      throw new Error('boom');
    });
    subscribeNavState(() => seen.push('ok'));
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual(['ok']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('unsubscribe stops delivery; reset clears listeners', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    off();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([]);
    subscribeNavState(() => seen.push(true as unknown as boolean));
    __resetTransitionStateForTesting();
    makeRouterLoadTracker().onLoadStart();
    await flush();
    expect(seen).toEqual([]);
  });

  // F1: a leaked token (onLoadStart with no matching onLoadEnd) self-heals.
  it('the watchdog forces pending false after NAV_PENDING_MAX_MS when a token leaks', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart(); // leaks: never onLoadEnd
    await flush();
    expect(getNavPending()).toBe(true);
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getNavPending()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a genuine onLoadEnd before the watchdog cancels the self-heal (no double emit)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await flush();
    t.onLoadEnd();
    await flush();
    expect(seen).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(10_000); // watchdog must have been disarmed
    expect(seen).toEqual([true, false]);
  });

  // F3: subscribing while a reconcile is queued must not double-deliver true.
  it('does not double-deliver true to a listener that subscribes before the reconcile flush', async () => {
    makeRouterLoadTracker().onLoadStart(); // queues a reconcile microtask
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    await flush();
    expect(seen).toEqual([true]); // exactly once
  });
});
