// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { render as renderOutcome } from '../../page-only.js';
import { redirect } from '../../outcomes.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
  route: () => {},
} as never;

describe('PageMiddlewareHost', () => {
  it('renders children when no middleware short-circuits (client)', async () => {
    const mw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  it('renders the alternative component on render() outcome', async () => {
    const Alt = () => <div>alternative</div>;
    const mw = defineClientMiddleware(async () => {
      throw renderOutcome(Alt);
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('alternative')).not.toBeNull()
    );
    expect(screen.queryByText('page-content')).toBeNull();
  });

  it('renders nothing while the chain is pending then renders children once resolved', async () => {
    let resolve!: () => void;
    const mw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        resolve = r;
      });
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    expect(screen.queryByText('page-content')).toBeNull();
    resolve();
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  // B2 regression pin: PageMiddlewareHost must not re-dispatch the chain on
  // every render. Before the lazy-ref fix, `useRef(wrapPromise(startChain(...)))`
  // synchronously called `startChain` on each render before useRef decided
  // whether to use it, so the middleware function ran O(renders) times.
  it('runs each middleware once per path (does not re-dispatch on re-render)', async () => {
    const calls: number[] = [];
    let i = 0;
    const mw = defineClientMiddleware(async (_c, next) => {
      calls.push(++i);
      await next();
    });

    // Re-rendering the same tree triggers Preact reconciliation through
    // PageMiddlewareHost. Use rerender() to force multiple render passes
    // for the same path.
    const { rerender } = rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(screen.queryByText('once')).not.toBeNull());

    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>once</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );

    // Give any pending microtasks a chance to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.length).toBe(1);
  });

  // B8: navigating between paths must re-enter the chain. The lazy-ref
  // sentinel resets when `location.path` changes, so the new path's
  // middleware runs fresh.
  it('re-enters middleware when location.path changes', async () => {
    let runs = 0;
    const mw = defineClientMiddleware(async (_c, next) => {
      runs += 1;
      await next();
    });

    const locA = {
      path: '/a',
      url: 'http://localhost/a',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;
    const locB = {
      path: '/b',
      url: 'http://localhost/b',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;

    const { rerender } = rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={locA}>
          <div>page</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(runs).toBeGreaterThanOrEqual(1));
    const afterA = runs;

    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={locB}>
          <div>page</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(runs).toBe(afterA + 1));
  });

  // B9: client-side redirect from middleware. The effect-driven navigation
  // must move the browser to the redirect target. Without the effect path,
  // navigation would happen during render (forbidden by Suspense semantics)
  // or never (if swallowed by the RouteBoundary fallback).
  //
  // On the INITIAL load the redirect must be a hard navigation
  // (window.location.assign), not an SPA route(): an effect-driven route()
  // during hydration leaves preact-iso's Router holding the server-committed
  // DOM alongside the redirect target, double-mounting both routes in
  // <main>. A full document replacement guarantees no stale route DOM. See
  // docs/superpowers/research/2026-05-30-client-redirect-double-mount.md.
  it('client redirect on initial load hard-navigates instead of route() (double-mount fix)', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const mw = defineClientMiddleware(async () => {
      throw redirect('/login');
    });

    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>protected-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );

    // After the chain resolves with a redirect outcome the consumer must
    // NOT render the children (it returns null pending the effect-scheduled
    // nav).
    await waitFor(() => {
      expect(screen.queryByText('protected-content')).toBeNull();
    });

    // The effect should have run by now: a hard navigation to the target.
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/login');
    });
    // It must NOT have used SPA route(): the provider URL is unchanged.
    expect(window.location.pathname).not.toBe('/login');
  });

  // B9b: a redirect that fires AFTER a client navigation keeps the SPA
  // route() path. There is no server-committed-then-retained tree to leak
  // post-navigation, and a hard nav would needlessly drop SPA state. This
  // pins the parity half of the double-mount fix.
  it('client redirect after a navigation uses SPA route(), not a hard navigation', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const locA = {
      path: '/a',
      url: 'http://localhost/a',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;
    const locB = {
      path: '/b',
      url: 'http://localhost/b',
      searchParams: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook;

    const pass = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const redirecting = defineClientMiddleware(async () => {
      throw redirect('/login');
    });

    const { rerender } = rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[pass]} location={locA}>
          <div>page-a</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() => expect(screen.queryByText('page-a')).not.toBeNull());

    rerender(
      <LocationProvider>
        <PageMiddlewareHost use={[redirecting]} location={locB}>
          <div>page-b</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );

    // SPA route() moves the provider URL to the target.
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
