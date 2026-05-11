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

  it('opts in to view transitions while mounted', () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    vi.stubGlobal('document', Object.assign(document, { startViewTransition }));

    const { unmount } = render(<ViewTransitions />);

    __dispatchRouteChange('/a', undefined);
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    unmount();

    __dispatchRouteChange('/b', '/a');
    expect(startViewTransition).toHaveBeenCalledTimes(1); // not called after unmount
  });
});
