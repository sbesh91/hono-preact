// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FunctionComponent } from 'preact';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';
import type { LoaderRef } from '../define-loader.js';
import type { RouteHook } from 'preact-iso';

// These exercise the CLIENT render contract of `LoaderRef.View` / `.Boundary`:
// the children mount eagerly during the pending window (no Suspense fallback),
// then re-render with data. So they run in browser mode (the default in
// happy-dom). In browser mode the runner would POST to `/__loaders`, which has
// no server here, so mock `runLoader` to invoke the loader's own `fn` directly
// with the resolved location. The server-only suspension path (`DataReader`,
// gated on `!isBrowser()`) is intentionally NOT exercised by these unit tests:
// it needs `renderToStringAsync` to catch the throw, which the server SSR
// integration tests cover.
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

describe('LoaderRef.Boundary', () => {
  it('renders children eagerly while pending (loading, no data) then with data', async () => {
    let resolveData: (v: { value: number }) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise<{ value: number }>((res) => {
          resolveData = res;
        })
    );
    const ref = defineLoader<{ value: number }>(fn, {
      __moduleKey: 'pages/test-boundary',
    });

    // Loading-aware probe: state-based rendering mounts the children during the
    // pending window, so `data` is undefined until the loader resolves. There is
    // no separate Suspense fallback element.
    const Probe = () => {
      const data = ref.useData() as { value: number } | undefined;
      if (data === undefined) return <span data-testid="pending">loading</span>;
      return <span data-testid="data">{data.value}</span>;
    };

    const locMap = new Map();
    locMap.set('pages/test-boundary', {
      path: '/',
      pathParams: {},
      searchParams: {},
    });

    const tree = (
      <RouteLocationsContext.Provider value={locMap}>
        <ref.Boundary>
          <Probe />
        </ref.Boundary>
      </RouteLocationsContext.Provider>
    );

    const { findByTestId, queryByTestId } = render(tree);
    // Children mounted directly in the pending state (no fallback element).
    expect(queryByTestId('pending')).not.toBeNull();
    expect(queryByTestId('data')).toBeNull();
    // coerceLoaderLocation is async even with no schemas, so fn is invoked after
    // a microtask. Wait for it before using resolveData.
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    resolveData({ value: 42 });
    const el = await findByTestId('data');
    expect(el.textContent).toBe('42');
  });
});

describe('LoaderRef.View', () => {
  it('renders loading=true/data=undefined then provides data, loading=false to render fn', async () => {
    let resolveData: (v: { name: string }) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise<{ name: string }>((res) => {
          resolveData = res;
        })
    );
    const ref = defineLoader<{ name: string }>(fn, {
      __moduleKey: 'pages/test-view-1',
    });

    const View = ref.View(({ data, loading }) =>
      data === undefined ? (
        <span data-testid="pending">loading:{String(loading)}</span>
      ) : (
        <span data-testid="name">{data.name}</span>
      )
    );

    const locMap = new Map();
    locMap.set('pages/test-view-1', {
      path: '/',
      pathParams: {},
      searchParams: {},
    });

    const { queryByTestId, findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View />
      </RouteLocationsContext.Provider>
    );
    // Render fn ran with loading=true & data=undefined (no Suspense fallback).
    expect(queryByTestId('pending')?.textContent).toBe('loading:true');
    // coerceLoaderLocation is async even with no schemas, so fn is invoked after
    // a microtask. Wait for it before using resolveData.
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    resolveData({ name: 'ada' });
    const el = await findByTestId('name');
    expect(el.textContent).toBe('ada');
  });

  it('forwards arbitrary props to the render function', async () => {
    const ref = defineLoader<{ value: number }>(async () => ({ value: 1 }), {
      __moduleKey: 'pages/test-view-2',
    });
    const View: FunctionComponent<{ label: string }> = ref.View<{
      label: string;
    }>(({ data, label }) =>
      data === undefined ? null : (
        <span data-testid="composed">
          {label}:{data.value}
        </span>
      )
    );
    const locMap = new Map();
    locMap.set('pages/test-view-2', {
      path: '/',
      pathParams: {},
      searchParams: {},
    });

    const { findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View label="movie" />
      </RouteLocationsContext.Provider>
    );
    const el = await findByTestId('composed');
    expect(el.textContent).toBe('movie:1');
  });
});

describe('LoaderRef.Boundary: errorFallback', () => {
  it('renders errorFallback when the loader fn throws', async () => {
    const ref = defineLoader<{ value: number }>(
      async () => {
        throw new Error('boom');
      },
      { __moduleKey: 'pages/test-error-boundary' }
    );

    const locMap = new Map();
    locMap.set('pages/test-error-boundary', {
      path: '/',
      pathParams: {},
      searchParams: {},
    });

    const { findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <ref.Boundary errorFallback={<span data-testid="err">caught</span>}>
          <span data-testid="content">should not render</span>
        </ref.Boundary>
      </RouteLocationsContext.Provider>
    );

    const errEl = await findByTestId('err');
    expect(errEl.textContent).toBe('caught');
  });

  it('renders errorFallback from View opts when the loader fn throws', async () => {
    const ref = defineLoader<{ value: number }>(
      async () => {
        throw new Error('view-boom');
      },
      { __moduleKey: 'pages/test-error-view' }
    );

    const View = ref.View(
      ({ data }) =>
        data === undefined ? null : (
          <span data-testid="data">{data.value}</span>
        ),
      { errorFallback: <span data-testid="view-err">view-caught</span> }
    );

    const locMap = new Map();
    locMap.set('pages/test-error-view', {
      path: '/',
      pathParams: {},
      searchParams: {},
    });

    const { findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View />
      </RouteLocationsContext.Provider>
    );

    const errEl = await findByTestId('view-err');
    expect(errEl.textContent).toBe('view-caught');
  });
});

describe('LoaderRef.Boundary: reads location from RouteLocationsContext', () => {
  it('uses the location for its own moduleKey', async () => {
    const seen: { path: string }[] = [];
    const ref = defineLoader<{ path: string }>(
      async ({ location }) => {
        seen.push({ path: location.path });
        return { path: location.path };
      },
      { __moduleKey: 'pages/test-context-loc' }
    );

    const Probe = () => {
      const data = ref.useData() as { path: string } | undefined;
      if (data === undefined) return null;
      return <span data-testid="path">{data.path}</span>;
    };

    const layoutLoc = {
      path: '/movies',
      pathParams: {},
      searchParams: {},
    } as any;
    const pageLoc = {
      path: '/movies/123',
      pathParams: { id: '123' },
      searchParams: {},
    } as any;

    history.replaceState(null, '', '/movies/123');
    const { findByTestId } = render(
      <LocationProvider>
        <RouteLocationsProvider
          moduleKey="pages/movies-layout-test"
          location={layoutLoc}
        >
          <RouteLocationsProvider
            moduleKey="pages/test-context-loc"
            location={pageLoc}
          >
            <ref.Boundary>
              <Probe />
            </ref.Boundary>
          </RouteLocationsProvider>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    const el = await findByTestId('path');
    expect(el.textContent).toBe('/movies/123');
    expect(seen[0]).toEqual({ path: '/movies/123' });
  });
});
