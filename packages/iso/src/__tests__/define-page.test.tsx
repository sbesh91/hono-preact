// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import type { Context } from 'hono';
import { definePage, type PageBindings } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import type { LoaderRef } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import { HonoRequestContext } from '../internal/contexts.js';

const fakeC = {} as Context;

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

// Browser mode: loaders are state-based (no Suspense). The loader.View test
// below exercises that CLIENT contract through definePage/<Page>; in the
// browser the runner would POST to `/__loaders` (no server here), so mock
// `runLoader` to invoke the loader's own `fn` directly, mirroring
// loader-view.test.tsx. The SERVER suspension path (DataReader) is covered by
// the renderToStringAsync SSR integration tests, not the DOM renderer.
vi.mock('../is-browser.js', () => ({
  isBrowser: () => true,
  env: { current: 'browser' },
}));

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

afterEach(() => {
  cleanup();
});

const fakeLocation: RouteHook = {
  url: '/test',
  path: '/test',
  query: '',
  pathParams: {},
  searchParams: {},
  route: () => {},
} as RouteHook;

describe('definePage', () => {
  it('renders a loader.View component placed inside the page body', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello' }), {
      __moduleKey: 'test/define-page-loader-view',
    });

    const locMap = new Map();
    locMap.set('test/define-page-loader-view', fakeLocation);

    // State-based: the render fn runs eagerly during the pending window with
    // `data === undefined`, so guard for it (no separate Suspense fallback).
    const Body = loader.View(({ data }) =>
      data === undefined ? <p>loading</p> : <p data-testid="msg">{data.msg}</p>
    );

    function PageBody() {
      return <Body />;
    }

    const PageRoute = definePage(PageBody);

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <PageRoute {...fakeLocation} />
          </LocationProvider>
        </RouteLocationsContext.Provider>
      </HonoRequestContext.Provider>
    );

    expect(await screen.findByTestId('msg')).toHaveTextContent('hello');
  });

  it('returns a routable component for a binding-less page', async () => {
    function Body() {
      return <p>plain</p>;
    }
    const PageRoute = definePage(Body);
    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <LocationProvider>
          <PageRoute {...fakeLocation} />
        </LocationProvider>
      </HonoRequestContext.Provider>
    );
    expect(await screen.findByText('plain')).toBeInTheDocument();
  });

  it('threads errorFallback into <Page>', async () => {
    const bindings: PageBindings = {
      errorFallback: (err, reset) => (
        <button onClick={reset}>{err.message}</button>
      ),
    };
    function Body() {
      return <p>ok</p>;
    }
    const PageRoute = definePage(Body, bindings);
    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <LocationProvider>
          <PageRoute {...fakeLocation} />
        </LocationProvider>
      </HonoRequestContext.Provider>
    );
    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it('preserves the wrapped component name in displayName for debuggability', () => {
    function Movies() {
      return <p>movies</p>;
    }
    Movies.displayName = 'Movies';
    const PageRoute = definePage(Movies);
    expect(PageRoute.displayName).toBe('definePage(Movies)');
  });
});
