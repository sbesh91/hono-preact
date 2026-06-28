// @vitest-environment happy-dom
// Regression: a guarded route-to-route navigation keeps the outgoing route
// alive while the incoming route's page-middleware chain resolves (the Router
// is the suspense boundary), and commits the incoming route once it resolves.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render as rtlRender, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../history-shim.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetHistoryShimForTesting();
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
});

function NavOnce({ to }: { to: string }) {
  const { route } = useLocation();
  useEffect(() => {
    const id = setTimeout(() => {
      setNavDirectionForTesting('push');
      route(to);
    }, 0);
    return () => clearTimeout(id);
  }, [route, to]);
  return null;
}

describe('guarded route hold-alive', () => {
  it('holds the outgoing route alive while the incoming chain is pending', async () => {
    const gate: { release?: () => void } = {};
    const fastMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const gatedMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      await next();
    });
    const A = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [fastMw], location: loc },
        h('div', { 'data-testid': 'route-A' }, 'route-A')
      );
    const B = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [gatedMw], location: loc },
        h('div', { 'data-testid': 'route-B' }, 'route-B')
      );
    const onLoadStart = vi.fn();

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(
        LocationProvider,
        null,
        h(NavOnce, { to: '/b' }),
        h(
          Router,
          { onLoadStart },
          h(Route, { path: '/a', component: A as never }),
          h(Route, { path: '/b', component: B as never })
        )
      )
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );
    // The Router fires onLoadStart ONLY when its own __c catches a thrown
    // promise, so this asserts the guarded chain suspension reached the Router.
    await waitFor(() => expect(onLoadStart).toHaveBeenCalledWith('/b'), {
      timeout: 2000,
    });
    // Outgoing route is held alive; incoming is not shown while pending.
    expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();

    gate.release?.();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-B"]')).not.toBeNull()
    );
    expect(container.querySelector('[data-testid="route-A"]')).toBeNull();
  });

  // The "commits the incoming guarded route after its chain resolves (real
  // Routes)" case lived here too, but it duplicated guarded-nav-transition.test
  // (same defineRoutes + gated middleware + click flow). The resolve/commit path
  // is covered there; this file stays focused on the raw-Router hold-alive
  // mechanism (the test above), which the realistic Routes path can't observe
  // (onLoadStart is wired internally).
});
