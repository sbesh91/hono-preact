import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  makeRouterLoadTracker,
  getNavPending,
  subscribeNavState,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';

const microtask = () => Promise.resolve();

describe('nav-pending notify layer', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => __resetTransitionStateForTesting());

  it('getNavPending reflects the loadingRouters set', () => {
    expect(getNavPending()).toBe(false);
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('notifies subscribers on the false->true and true->false transitions', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await microtask();
    expect(seen).toEqual([true]);
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([true, false]);
    off();
  });

  it('coalesces synchronous churn: two starts in one tick emit one notification', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    makeRouterLoadTracker().onLoadStart();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([true]);
  });

  it('emits nothing when a burst nets to no pending change (start+end same tick)', async () => {
    const seen: boolean[] = [];
    subscribeNavState(() => seen.push(getNavPending()));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([]);
  });

  it('a guarded Router (double onLoadStart, single onLoadEnd) ends pending=false', () => {
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    t.onLoadStart(); // same token; Set collapses
    expect(getNavPending()).toBe(true);
    t.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('nested Routers: both must end before pending is false', () => {
    const outer = makeRouterLoadTracker();
    const inner = makeRouterLoadTracker();
    outer.onLoadStart();
    inner.onLoadStart();
    outer.onLoadEnd();
    expect(getNavPending()).toBe(true);
    inner.onLoadEnd();
    expect(getNavPending()).toBe(false);
  });

  it('unsubscribe stops delivery; reset clears listeners', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavState(() => seen.push(getNavPending()));
    off();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([]);
    // and a fresh subscriber is dropped by reset
    subscribeNavState(() => seen.push(true));
    __resetTransitionStateForTesting();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([]);
  });

  it('isolates a throwing listener so other subscribers still receive the change', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    subscribeNavState(() => {
      throw new Error('boom');
    });
    subscribeNavState(() => seen.push('ok'));
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual(['ok']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
