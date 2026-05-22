// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { Page } from '../page.js';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import type { Context } from 'hono';
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

// Per-mechanism middleware behavior is covered by middleware-runner.test.ts
// and the PageMiddlewareHost integration tests; this file focuses on the
// Page component's wrapper + errorFallback responsibilities. The legacy
// guard-prop describes were removed when Page swapped from <Guards> to
// <PageMiddlewareHost> (Task 25 of the loader-action-middleware plan).

describe('Page without a use list', () => {
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
      async () => {
        throw new Error('boom');
      },
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
