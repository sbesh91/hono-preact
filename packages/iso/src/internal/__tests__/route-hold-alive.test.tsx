// @vitest-environment happy-dom
// Regression: a guarded route-to-route navigation keeps the outgoing route
// alive while the incoming route's page-middleware chain resolves (the Router
// is the suspense boundary), and commits the incoming route once it resolves.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  cleanup,
  waitFor,
  fireEvent,
  findByTestId,
} from '@testing-library/preact';
import { LocationProvider, Router, Route, useLocation } from 'preact-iso';
import { h, type ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { defineRoutes, Routes, type ViewProps } from '../../define-routes.js';
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

  it('commits the incoming guarded route after its chain resolves (real Routes)', async () => {
    const slowMw = defineClientMiddleware(async (_c, next) => {
      await Promise.resolve();
      await Promise.resolve();
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [slowMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-B"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="to-b"]')).toBeNull();
  });
});
