// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { FunctionComponent } from 'preact';
import { render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';

// In happy-dom, isBrowser() returns true, which would cause LoaderHost to
// use the fetch path (POST /__loaders) instead of calling the fn directly.
// That path requires a running server, so mock it off for unit tests.
vi.mock('../is-browser.js', () => ({
  isBrowser: () => false,
  env: { current: 'server' },
}));

describe('LoaderRef.Boundary', () => {
  it('renders the loader fallback then transitions to children with data', async () => {
    let resolveData: (v: { value: number }) => void = () => {};
    const ref = defineLoader<{ value: number }>(
      () => new Promise<{ value: number }>((res) => { resolveData = res; }),
      { __moduleKey: 'pages/test-boundary' }
    );

    const Probe = () => {
      const data = ref.useData();
      return <span data-testid="data">{data.value}</span>;
    };

    const locMap = new Map();
    locMap.set('pages/test-boundary', { path: '/', pathParams: {}, searchParams: {} });

    const tree = (
      <RouteLocationsContext.Provider value={locMap}>
        <ref.Boundary fallback={<span data-testid="fallback">loading</span>}>
          <Probe />
        </ref.Boundary>
      </RouteLocationsContext.Provider>
    );

    const { findByTestId, queryByTestId } = render(tree);
    expect(queryByTestId('fallback')).not.toBeNull();
    resolveData({ value: 42 });
    const el = await findByTestId('data');
    expect(el.textContent).toBe('42');
  });
});

describe('LoaderRef.View', () => {
  it('renders fallback then provides data, error, reload to render fn', async () => {
    let resolveData: (v: { name: string }) => void = () => {};
    const ref = defineLoader<{ name: string }>(
      () => new Promise<{ name: string }>((res) => { resolveData = res; }),
      { __moduleKey: 'pages/test-view-1' }
    );

    const View = ref.View(
      ({ data }) => <span data-testid="name">{data.name}</span>,
      { fallback: <span data-testid="fallback">…</span> }
    );

    const locMap = new Map();
    locMap.set('pages/test-view-1', { path: '/', pathParams: {}, searchParams: {} });

    const { queryByTestId, findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View />
      </RouteLocationsContext.Provider>
    );
    expect(queryByTestId('fallback')).not.toBeNull();
    resolveData({ name: 'ada' });
    const el = await findByTestId('name');
    expect(el.textContent).toBe('ada');
  });

  it('forwards arbitrary props to the render function', async () => {
    const ref = defineLoader<{ value: number }>(
      async () => ({ value: 1 }),
      { __moduleKey: 'pages/test-view-2' }
    );
    const View: FunctionComponent<{ label: string }> = ref.View<{ label: string }>(
      ({ data, label }) => (
        <span data-testid="composed">{label}:{data.value}</span>
      ),
      { fallback: <span /> }
    );
    const locMap = new Map();
    locMap.set('pages/test-view-2', { path: '/', pathParams: {}, searchParams: {} });

    const { findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View label="movie" />
      </RouteLocationsContext.Provider>
    );
    const el = await findByTestId('composed');
    expect(el.textContent).toBe('movie:1');
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
      const data = ref.useData();
      return <span data-testid="path">{data.path}</span>;
    };

    const layoutLoc = { path: '/movies', pathParams: {}, searchParams: {} } as any;
    const pageLoc = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} } as any;

    history.replaceState(null, '', '/movies/123');
    const { findByTestId } = render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey="pages/movies-layout-test" location={layoutLoc}>
          <RouteLocationsProvider moduleKey="pages/test-context-loc" location={pageLoc}>
            <ref.Boundary fallback={<span />}>
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
