// @vitest-environment happy-dom
// Regression (#199, finding [0]): when a guarded route is superseded by a newer
// navigation, it is held alive as the Router's `prev`. Its middleware chain may
// still resolve later; the self-heal must NOT re-render the held route and fire
// its (now stale) redirect, which would override the user's current navigation.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render as rtlRender, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { h, type ComponentType } from 'preact';
import { defineClientMiddleware } from '../../define-middleware.js';
import { defineRoutes, Routes, type ViewProps } from '../../define-routes.js';
import { redirect } from '../../outcomes.js';
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

describe('superseded guarded route does not fire its stale redirect', () => {
  it('lands on the newest target, not a superseded route’s redirect', async () => {
    const gateB: { release?: () => void } = {};
    const gateC: { release?: () => void } = {};
    // B's guard blocks, then (once released, after C has superseded it) redirects.
    const bMw = defineClientMiddleware(async () => {
      await new Promise<void>((r) => {
        gateB.release = r;
      });
      throw redirect('/x');
    });
    // C's guard stays pending so B remains held as the Router's `prev` when B's
    // superseded guard resolves (the condition under which the stale redirect
    // fires).
    const cMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gateC.release = r;
      });
      await next();
    });

    const { Capture, nav } = createRouteCapture();
    const AView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-A' }, 'A');
    const CView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-C' }, 'C');
    const XView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-X' }, 'X');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'B');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [bMw],
      },
      {
        path: '/c',
        view: () => Promise.resolve({ default: CView }),
        use: [cMw],
      },
      { path: '/x', view: () => Promise.resolve({ default: XView }) },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(
        LocationProvider,
        null,
        h(Capture, null),
        h(Routes, { routes: manifest })
      )
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );

    // Navigate to B (its guard suspends, awaiting the gate). B is the cur route.
    setNavDirectionForTesting('push');
    nav('/b');
    await waitFor(() => expect(gateB.release).toBeDefined());

    // Supersede B with C before B settles. C also suspends, so B stays held as
    // the Router's prev.
    setNavDirectionForTesting('push');
    nav('/c');
    await waitFor(() => expect(gateC.release).toBeDefined());

    // Release B's (superseded) guard -> it resolves to redirect('/x'). The held
    // route must NOT navigate the app to /x.
    gateB.release?.();
    // Give any (incorrect) stale redirect a chance to fire.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(window.location.pathname).toBe('/c');
    expect(container.querySelector('[data-testid="route-X"]')).toBeNull();

    // Now let C commit; the app lands on C, never having detoured to /x.
    gateC.release?.();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-C"]')).not.toBeNull()
    );
    expect(window.location.pathname).toBe('/c');
    expect(container.querySelector('[data-testid="route-X"]')).toBeNull();
  });
});
