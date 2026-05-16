// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ViewTransitions } from '../view-transitions.js';
import { __dispatchRouteChange } from '../internal/route-change.js';

describe('ViewTransitions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing', () => {
    const { container } = render(<ViewTransitions />);
    expect(container.innerHTML).toBe('');
  });

  it('wraps same-origin link clicks in startViewTransition while mounted', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    Object.assign(document, { startViewTransition });

    const { unmount } = render(<ViewTransitions />);

    const link = document.createElement('a');
    link.href = location.origin + '/a';
    document.body.appendChild(link);

    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    unmount();

    link.click();
    expect(startViewTransition).toHaveBeenCalledTimes(1); // not called after unmount

    document.body.removeChild(link);
  });
});
