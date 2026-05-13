// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { RouteLocationsContext } from '../internal/route-locations.js';

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
    render(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    await waitFor(() => expect(observed).toBeInstanceOf(Map));
    const loc = observed.get('pages/foo');
    expect(loc).toBeDefined();
    expect(loc.path).toBe('/foo/123');
    expect(loc.pathParams).toEqual({ id: '123' });
  });
});
