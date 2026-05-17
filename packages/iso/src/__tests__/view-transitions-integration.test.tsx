// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { h } from 'preact';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider, useLocation } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { __dispatchRouteChange } from '../internal/route-change.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The first test navigates to /about via history.pushState; subsequent
  // tests need to start fresh at '/' or their LocationProvider initialises
  // off the leftover URL and renders About instead of Home.
  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', '/');
  }
});

// Real-DOM test that exercises the FULL wiring chain end-to-end:
//   LocationProvider → preact-iso <Router> (mounted by `Routes`) →
//   onRouteChange callback fires in useLayoutEffect → __dispatchRouteChange
//   → document.startViewTransition(cb).
//
// The previous coverage in route-change.test.ts called __dispatchRouteChange
// directly with a stubbed document. That tests "the dispatcher invokes the
// API when enabled"; it does NOT test that a real Router-driven navigation
// actually reaches the dispatcher. Given how recently the view-transitions
// opt-in plumbing thrashed (74f952c → e837831), this is the regression we
// most want a guard against.
describe('view transitions: end-to-end wiring', () => {
  // A view component that uses useLocation so we can trigger a programmatic
  // navigation from inside the rendered tree (mirrors how real apps call
  // `useLocation().route(...)` from event handlers).
  const Home = () => {
    const { route } = useLocation();
    return h('button', { onClick: () => route('/about') }, 'go to about');
  };
  const About = () => h('h1', null, 'About');

  it('fires document.startViewTransition once per navigation triggered through the Router', async () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    Object.assign(document, { startViewTransition });

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    // Wire onRouteChange the same way the framework's generated client
    // entry does: forward every Router commit into __dispatchRouteChange.
    let lastPath: string | undefined;
    function onRouteChange(path: string): void {
      const from = lastPath;
      lastPath = path;
      __dispatchRouteChange(path, from);
    }

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes, onRouteChange }))
    );

    // Wait for the lazy Home view to mount.
    await waitFor(() => expect(container.querySelector('button')).not.toBeNull());

    // Initial mount does not fire onRouteChange (preact-iso's Router only
    // fires onRouteChange when prevRoute.current !== path). startViewTransition
    // should still be at zero calls before any user-driven nav.
    expect(startViewTransition).not.toHaveBeenCalled();

    // Click triggers route('/about') → reducer updates url → Router renders
    // About → useLayoutEffect fires onRouteChange → __dispatchRouteChange →
    // startViewTransition.
    fireEvent.click(container.querySelector('button')!);

    await waitFor(() => expect(startViewTransition).toHaveBeenCalledTimes(1));
    // The callback passed to startViewTransition must be a function. Real
    // browsers call it inside the snapshot window; the framework hands them
    // `() => flushSync(() => {})`.
    expect(typeof startViewTransition.mock.calls[0][0]).toBe('function');
  });

  it('does not call startViewTransition when the API is unavailable on document', async () => {
    // Browsers without view-transitions: dispatching should still notify
    // subscribers (other __dispatchRouteChange consumers) without throwing.
    Object.assign(document, { startViewTransition: undefined });

    const routes = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Home }) },
      { path: '/about', view: () => Promise.resolve({ default: About }) },
    ]);

    let lastPath: string | undefined;
    const onRouteChange = (path: string): void => {
      const from = lastPath;
      lastPath = path;
      __dispatchRouteChange(path, from);
    };

    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes, onRouteChange }))
    );
    await waitFor(() => expect(container.querySelector('button')).not.toBeNull());

    // Should NOT throw and should NOT call any view-transition API.
    expect(() => fireEvent.click(container.querySelector('button')!)).not.toThrow();
  });
});
