// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import {
  DelayedFallback,
  DEFAULT_FALLBACK_DELAY_MS,
} from '../delayed-fallback.js';
import { env } from '../../is-browser.js';

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  env.current = originalEnv;
  cleanup();
});

const Fb = () => <div data-testid="fb">Loading…</div>;

describe('DelayedFallback', () => {
  it('exposes a 100ms default delay', () => {
    expect(DEFAULT_FALLBACK_DELAY_MS).toBe(100);
  });

  it('renders nothing before the delay elapses', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).toBeNull();
  });

  it('renders children once the delay elapses', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('keeps waiting right up to the threshold', () => {
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByTestId('fb')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('renders immediately when delay is 0', () => {
    render(
      <DelayedFallback delay={0}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('renders immediately on the server', () => {
    env.current = 'server';
    render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    expect(screen.queryByTestId('fb')).not.toBeNull();
  });

  it('does not render children if unmounted before the delay', () => {
    const { unmount } = render(
      <DelayedFallback delay={100}>
        <Fb />
      </DelayedFallback>
    );
    unmount();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(200);
      })
    ).not.toThrow();
    expect(screen.queryByTestId('fb')).toBeNull();
  });
});
