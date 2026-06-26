// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { Page } from '../page.js';
import { defineLoader } from '../define-loader.js';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import type { Context } from 'hono';
import { HonoRequestContext } from '../internal/contexts.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({ present: false })),
  deletePreloadedData: vi.fn(),
}));

// The loader tests below exercise the CLIENT render contract through <Page>:
// loaders are state-based in the browser (no Suspense), so children mount
// eagerly during the pending window and re-render with data, and a cold error
// re-throws up to the page-level errorFallback. In browser mode the runner
// would POST to `/__loaders` (no server here), so mock `runLoader` to invoke
// the loader's own `fn` directly with the resolved location, mirroring
// loader-view.test.tsx. The SERVER suspension path (DataReader, gated on
// `!isBrowser()`) is covered by the renderToStringAsync SSR integration tests
// (packages/server render.test.tsx / render-stream.test.tsx), not the DOM
// renderer.
vi.mock('../internal/loader-runner.js', () => ({
  runLoader: <T,>(
    loaderRef: LoaderRef<T, boolean>,
    location: RouteHook,
    _id: string,
    signal: AbortSignal
  ): Promise<T> => {
    const invoke = loaderRef.fn as unknown as (arg: {
      signal: AbortSignal;
      location: RouteHook;
    }) => Promise<T>;
    return Promise.resolve(invoke({ signal, location }));
  },
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

beforeEach(() => {
  mockRoute.mockClear();
});
afterEach(() => {
  cleanup();
});

// Per-mechanism middleware behavior is covered by middleware-runner.test.ts.
// This file focuses on the Page component's own responsibilities: the error
// boundary, Wrapper rendering, and loader content passing through with no
// middleware host present.

describe('Page renders children in a default Wrapper', () => {
  it('renders children inside a default Wrapper', async () => {
    render(
      <LocationProvider>
        <Page>
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
    // Client state-based path (browser mode, runLoader mocked above). A cold
    // loader failure surfaces by LoaderHost re-throwing up to the page-level
    // errorFallback (the framework RouteBoundary), since the loader.Boundary
    // here carries no local errorFallback.
    const failing = defineLoader<{ msg: string }>(
      async () => {
        throw new Error('boom');
      },
      { __moduleKey: 'test/page-error-boundary' }
    );

    const locMap = new Map();
    locMap.set('test/page-error-boundary', loc);

    function PageContent() {
      // State-based: children render eagerly during the pending window, so
      // `useData()` returns undefined until the loader resolves. Guard for it.
      const s = failing.useData();
      if (!('data' in s)) return null;
      return <p data-testid="content">{s.data.msg}</p>;
    }

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <Page
              errorFallback={(err) => (
                <div data-testid="error">{err.message}</div>
              )}
            >
              <failing.Boundary>
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

describe('Page renders loader content', () => {
  it('renders a resolving loader through Page', async () => {
    const ok = defineLoader<{ msg: string }>(async () => ({ msg: 'loaded' }), {
      __moduleKey: 'test/page-content',
    });

    const locMap = new Map();
    locMap.set('test/page-content', loc);

    function PageContent() {
      // State-based: children render eagerly during the pending window, so
      // `useData()` returns undefined until the loader resolves. Guard for it.
      const s = ok.useData();
      if (!('data' in s)) return null;
      return <p data-testid="content">{s.data.msg}</p>;
    }

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <Page>
              <ok.Boundary>
                <PageContent />
              </ok.Boundary>
            </Page>
          </LocationProvider>
        </RouteLocationsContext.Provider>
      </HonoRequestContext.Provider>
    );

    const el = await screen.findByTestId('content');
    expect(el).toHaveTextContent('loaded');
  });
});
