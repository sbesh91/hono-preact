// @vitest-environment happy-dom
// Regression: a guarded route-to-route navigation keeps the outgoing route
// alive while the incoming route's page-middleware chain resolves (the Router
// is the suspense boundary), and commits the incoming route once it resolves.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  cleanup,
  waitFor,
  act,
} from '@testing-library/preact';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { createRouteCapture } from '../../__tests__/route-test-helpers.js';
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

  it('self-heals a held guarded route after a query-only navigation while its chain is pending', async () => {
    // Regression: the self-heal supersede gate must compare PATHNAME, not the
    // full URL. A query-only navigation on the same path while the chain is
    // pending does not re-dispatch the chain (SuspenseHost keys on
    // location.path) and preact-iso's resume re-renders the Router but bails on
    // the unchanged cur vnode, so the framework force() is the only thing that
    // re-renders the consumer. A full-URL gate would see currentUrl change
    // ('/b' -> '/b?range=30d') and suppress that force(), freezing the route.
    const gate: { release?: () => void } = {};
    const gatedMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      await next();
    });
    const { Capture, nav } = createRouteCapture();
    const A = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [], location: loc },
        h('div', { 'data-testid': 'route-A' }, 'route-A')
      );
    const B = (loc: never) =>
      h(
        PageMiddlewareHost,
        { use: [gatedMw], location: loc },
        h('div', { 'data-testid': 'route-B' }, 'route-B')
      );

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(
        LocationProvider,
        null,
        h(Capture, null),
        h(
          Router,
          null,
          h(Route, { path: '/a', component: A as never }),
          h(Route, { path: '/b', component: B as never })
        )
      )
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );

    // Navigate to the guarded /b; its chain is gated (stays pending).
    act(() => {
      setNavDirectionForTesting('push');
      nav('/b');
    });
    await waitFor(() => expect(gate.release).toBeDefined());
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();

    // Query-only navigation on the SAME path while the chain is pending.
    act(() => {
      nav('/b?range=30d');
    });

    // Release the guard: the route must still commit (pathname unchanged), not
    // freeze on the held outgoing route.
    gate.release?.();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-B"]')).not.toBeNull()
    );
  });

  // The "commits the incoming guarded route after its chain resolves (real
  // Routes)" case lived here too, but it duplicated guarded-nav-transition.test
  // (same defineRoutes + gated middleware + click flow). The resolve/commit path
  // is covered there; this file stays focused on the raw-Router hold-alive
  // mechanism (the test above), which the realistic Routes path can't observe
  // (onLoadStart is wired internally).
});
