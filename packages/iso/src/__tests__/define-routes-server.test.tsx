// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import { defineServerMiddleware } from '../define-middleware.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) => children as never,
  });
const noopServer = () => Promise.resolve({});

const a = defineServerMiddleware(async (_c, next) => next());
const b = defineServerMiddleware(async (_c, next) => next());

describe('defineRoutes: per-route location plumbing', () => {
  it('installs RouteLocationsProvider for a page-level server module', async () => {
    let observed: any = null;
    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    const manifest = defineRoutes([
      {
        path: '/foo/:id',
        view: () => Promise.resolve({ default: Probe }),
        server: () => Promise.resolve({ __moduleKey: 'pages/foo' }),
      },
    ]);

    history.replaceState(null, '', '/foo/123');
    render(h(LocationProvider, null, h(Routes, { routes: manifest })));

    await waitFor(() => expect(observed).toBeInstanceOf(Map));
    const loc = observed.get('pages/foo');
    expect(loc).toBeDefined();
    expect(loc.path).toBe('/foo/123');
    expect(loc.pathParams).toEqual({ id: '123' });
  });
});

describe('routeUse', () => {
  it('composes routeUse outer-to-inner down the tree', () => {
    const m = defineRoutes([
      {
        path: '/app',
        layout: noopLayout,
        children: [
          { path: 'open', view: noopView, server: noopServer },
          {
            path: 'area',
            use: [a],
            children: [
              { path: '', view: noopView, server: noopServer },
              {
                path: ':id',
                layout: noopLayout,
                use: [b],
                children: [{ path: '', view: noopView, server: noopServer }],
              },
            ],
          },
        ],
      },
    ]);
    const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
    // server-bearing leaf with no guard in its ancestry.
    expect(byPath.get('/app/open')).toEqual([]);
    // '' child of the guarded `area` grouping inherits [a].
    expect(byPath.get('/app/area')).toEqual([a]);
    // '' child of the guarded `:id` layout inherits [a, b] outer-first.
    expect(byPath.get('/app/area/:id')).toEqual([a, b]);
    // Each matchable pattern appears exactly once (no duplicate entries).
    expect(m.routeUse.filter((r) => r.path === '/app/area/:id')).toHaveLength(
      1
    );
  });
});

describe('defineRoutes: layout-level server plumbing', () => {
  it('allows a layout to declare server and installs a stable layout location', async () => {
    let observed: any = null;
    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    // Layout component that renders the inner Router output as <main>.
    const Layout = ({ children }: { children: any }) =>
      h('main', null, children);

    const manifest = defineRoutes([
      {
        path: '/movies',
        layout: () => Promise.resolve({ default: Layout as any }),
        server: () => Promise.resolve({ __moduleKey: 'pages/movies-layout' }),
        children: [
          {
            path: ':id',
            view: () => Promise.resolve({ default: Probe }),
            server: () => Promise.resolve({ __moduleKey: 'pages/movie' }),
          },
        ],
      },
    ]);

    // Set the URL via history because LocationProvider in this preact-iso
    // version reads from window.location, not from a `url` prop.
    history.replaceState(null, '', '/movies/123');
    render(h(LocationProvider, null, h(Routes, { routes: manifest })));

    await waitFor(() => expect(observed?.get('pages/movie')).toBeDefined());
    const layoutLoc = observed.get('pages/movies-layout');
    const pageLoc = observed.get('pages/movie');
    expect(layoutLoc).toBeDefined();
    expect(layoutLoc.path).toBe('/movies');
    expect(pageLoc.path).toBe('/movies/123');
    expect(pageLoc.pathParams).toEqual({ id: '123' });
  });
});
