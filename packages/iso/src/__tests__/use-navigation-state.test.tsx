// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import {
  makeRouterLoadTracker,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';
import {
  subscribeNavigationState,
  useNavigationState,
} from '../use-navigation-state.js';

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

function Probe({ delayMs }: { delayMs?: number }) {
  const { pending } = useNavigationState(
    delayMs === undefined ? undefined : { delayMs }
  );
  return h('span', { 'data-testid': 'p' }, pending ? 'pending' : 'idle');
}

describe('useNavigationState', () => {
  beforeEach(() => __resetTransitionStateForTesting());
  afterEach(() => {
    cleanup();
    __resetTransitionStateForTesting();
    vi.useRealTimers();
  });

  it('returns pending:false on initial render (the SSR / initial-load value)', () => {
    const { getByTestId } = render(h(Probe, {}));
    expect(getByTestId('p').textContent).toBe('idle');
  });

  it('re-renders pending:true while a load is in flight, then false', async () => {
    const { getByTestId } = render(h(Probe, {}));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    // The notify is a microtask and the store re-render is a state update
    // outside act(); waitFor polls until the DOM settles.
    await waitFor(() => expect(getByTestId('p').textContent).toBe('pending'));
    t.onLoadEnd();
    await waitFor(() => expect(getByTestId('p').textContent).toBe('idle'));
  });

  it('with delayMs, stays idle until the delay elapses', async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(h(Probe, { delayMs: 200 }));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await vi.advanceTimersByTimeAsync(0); // flush notify microtask + effect setup
    expect(getByTestId('p').textContent).toBe('idle'); // delay not elapsed
    await vi.advanceTimersByTimeAsync(200);
    expect(getByTestId('p').textContent).toBe('pending');
  });

  it('with delayMs, a load that ends before the delay never shows pending', async () => {
    vi.useFakeTimers();
    const { getByTestId } = render(h(Probe, { delayMs: 200 }));
    const t = makeRouterLoadTracker();
    t.onLoadStart();
    await vi.advanceTimersByTimeAsync(100);
    expect(getByTestId('p').textContent).toBe('idle'); // mid-flight: still gated, delay not elapsed
    t.onLoadEnd();
    await vi.advanceTimersByTimeAsync(200);
    expect(getByTestId('p').textContent).toBe('idle');
  });
});
