// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { Page } from '../page.js';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import type { Context } from 'hono';
import { defineServerGuard, defineClientGuard, GuardRedirect, runServerGuards } from '../guard.js';
import { HonoRequestContext } from '../internal/contexts.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const fakeC = {} as Context;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  mockRoute.mockClear();
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('guard { render }', () => {
  it('renders the guard-supplied component instead of the page', async () => {
    const ForbiddenPage = () => (
      <div data-testid="forbidden">403 Forbidden</div>
    );
    const guard = defineClientGuard(async () => ({ render: ForbiddenPage }));

    render(
      <LocationProvider>
        <Page location={loc} guards={[guard]}>
          <div data-testid="page">Protected content</div>
        </Page>
      </LocationProvider>
    );

    const el = await screen.findByTestId('forbidden');
    expect(el).toHaveTextContent('403 Forbidden');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } in browser', () => {
  it('calls route() with the redirect path when a client guard redirects', async () => {
    const guard = defineClientGuard(async () => ({ redirect: '/login' }));

    render(
      <LocationProvider>
        <Page location={loc} guards={[guard]}>
          <div data-testid="page">Protected</div>
        </Page>
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalled());
    expect(mockRoute).toHaveBeenCalledWith('/login');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } on server', () => {
  it('throws GuardRedirect when a server guard redirects', async () => {
    const guard = defineServerGuard(async () => ({ redirect: '/login' }));
    const result = await runServerGuards([guard], { c: fakeC, location: loc });
    expect(result).toHaveProperty('redirect', '/login');
    expect(() => {
      if (result && 'redirect' in result)
        throw new GuardRedirect(result.redirect);
    }).toThrow(GuardRedirect);
  });
});

describe('guard re-runs on navigation', () => {
  it('re-evaluates guards when the path changes', async () => {
    let currentPath = '/public';
    const guard = defineClientGuard(async () => {
      if (currentPath === '/admin') return { redirect: '/login' };
    });

    const locPublic = { ...loc, path: '/public' } as unknown as RouteHook;
    const { rerender } = render(
      <LocationProvider>
        <Page location={locPublic} guards={[guard]}>
          <div data-testid="page">Content</div>
        </Page>
      </LocationProvider>
    );

    await screen.findByTestId('page');

    currentPath = '/admin';
    const locAdmin = { ...loc, path: '/admin' } as unknown as RouteHook;
    rerender(
      <LocationProvider>
        <Page location={locAdmin} guards={[guard]}>
          <div data-testid="page">Content</div>
        </Page>
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalledWith('/login'));
  });
});

describe('Page without a loader', () => {
  it('renders children inside a default Wrapper', async () => {
    render(
      <LocationProvider>
        <Page location={loc}>
          <p data-testid="content">Hello</p>
        </Page>
      </LocationProvider>
    );

    const el = await screen.findByTestId('content');
    expect(el).toHaveTextContent('Hello');
  });
});

describe('Page errorFallback catches loader errors', () => {
  it('renders errorFallback when a loader.Boundary child throws', async () => {
    // Use server mode so the loader invokes fn() directly rather than fetch.
    env.current = 'server';

    const failing = defineLoader<{ msg: string }>(
      async () => { throw new Error('boom'); },
      { __moduleKey: 'test/page-error-boundary' }
    );

    const locMap = new Map();
    locMap.set('test/page-error-boundary', loc);

    function PageContent() {
      const { msg } = failing.useData();
      return <p data-testid="content">{msg}</p>;
    }

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <Page
              location={loc}
              errorFallback={(err) => (
                <div data-testid="error">{err.message}</div>
              )}
            >
              <failing.Boundary
                fallback={<div data-testid="loading">Loading...</div>}
              >
                <PageContent />
              </failing.Boundary>
            </Page>
          </LocationProvider>
        </RouteLocationsContext.Provider>
      </HonoRequestContext.Provider>
    );

    const el = await screen.findByTestId('error');
    expect(el).toHaveTextContent('boom');
    expect(screen.queryByTestId('content')).toBeNull();
  });
});
