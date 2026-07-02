// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeRouterLoadTracker,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import { subscribeNavigationState } from '../use-navigation-state.js';

const microtask = () => Promise.resolve();

describe('subscribeNavigationState', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => __resetTransitionStateForTesting());

  it('fires once immediately with the current state', () => {
    const seen: boolean[] = [];
    const off = subscribeNavigationState((s) => seen.push(s.pending));
    expect(seen).toEqual([false]);
    off();
  });

  it('fires on each transition until unsubscribed', async () => {
    const seen: boolean[] = [];
    const off = subscribeNavigationState((s) => seen.push(s.pending));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await microtask();
    t.onLoadEnd();
    await microtask();
    expect(seen).toEqual([false, true, false]);
    off();
    makeRouterLoadTracker().onLoadStart();
    await microtask();
    expect(seen).toEqual([false, true, false]);
  });
});
