/**
 * Tests for the route-marker-driven chain composition in loadersHandler:
 *
 * - Route-independent loader (no `__routeId`): chain is `[app, unit]`, the
 *   page-use resolver is NOT consulted.
 * - Route-bound loader (`__routeId` set): chain is `[app, page, unit]`, guards
 *   come from the loader's OWN declared route.
 * - Route-bound loader whose declared route does not resolve: rejected (500),
 *   never run guard-less.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
} from '@hono-preact/iso';
import { _defineRouteLoader } from '@hono-preact/iso/internal';
import { loadersHandler } from '../loaders-handler.js';

function mw(name: string, calls: string[]) {
  return defineServerMiddleware<'loader'>(async (_c, next) => {
    calls.push(name);
    await next();
  });
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('loadersHandler: route-marker chain composition', () => {
  it('route-independent loader composes [app, unit] — page resolver is NOT called', async () => {
    const calls: string[] = [];
    const appMw = mw('app', calls);
    const unitMw = mw('unit', calls);
    const pageMw = mw('page', calls);

    // bare defineLoader has no __routeId
    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'mod/a', __loaderName: 'data', use: [unitMw] }
    );

    const serverModules: Record<string, unknown> = {
      'mod/a': {
        __moduleKey: 'mod/a',
        serverLoaders: { data: loader },
      },
    };

    const resolvePageUse = vi.fn(() => [pageMw]);
    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        appConfig: defineApp({ use: [appMw] }),
        resolvePageUse,
      })
    );

    const res = await post(app, {
      module: 'mod/a',
      loader: 'data',
      location: { path: '/a', pathParams: {}, searchParams: {} },
    });

    expect(res.status).toBe(200);
    await res.json();
    // Page middleware must not run and the resolver must not be consulted.
    expect(calls).toEqual(['app', 'unit', 'inner']);
    expect(resolvePageUse).not.toHaveBeenCalled();
  });

  it('route-bound loader composes [app, page, unit] from its declared route', async () => {
    const calls: string[] = [];
    const appMw = mw('app', calls);
    const unitMw = mw('unit', calls);
    const pageMw = mw('page', calls);

    // _defineRouteLoader stamps __routeId so the handler composes the page tier
    // from the loader's declared route rather than treating it as route-independent.
    const loader = _defineRouteLoader(
      '/movies',
      async () => {
        calls.push('inner');
        return 'ok';
      },
      {
        __moduleKey: 'mod/b',
        __loaderName: 'data',
        use: [unitMw],
      }
    );

    const serverModules: Record<string, unknown> = {
      'mod/b': {
        __moduleKey: 'mod/b',
        serverLoaders: { data: loader },
      },
    };

    // Resolver returns page middleware only when asked for the loader's own route.
    const resolvePageUse = vi.fn((path: string) =>
      path === '/movies' ? [pageMw] : []
    );
    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        appConfig: defineApp({ use: [appMw] }),
        resolvePageUse,
      })
    );

    const res = await post(app, {
      module: 'mod/b',
      loader: 'data',
      // The client sends its current path, which is intentionally different from
      // the loader's declared route. Guards must still come from the declared
      // route (/movies), not from the client-sent path (/other).
      location: { path: '/other', pathParams: {}, searchParams: {} },
    });

    expect(res.status).toBe(200);
    await res.json();
    expect(calls).toEqual(['app', 'page', 'unit', 'inner']);
    // Resolver was consulted with the declared routeId, not the client path.
    expect(resolvePageUse).toHaveBeenCalledWith('/movies');
    expect(resolvePageUse).not.toHaveBeenCalledWith('/other');
  });

  it('route-bound loader with an unresolvable routeId is rejected with 500 (never run guard-less)', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ secret: 'data' });

    const loader = _defineRouteLoader('/protected', loaderFn, {
      __moduleKey: 'mod/c',
      __loaderName: 'data',
    });

    const serverModules: Record<string, unknown> = {
      'mod/c': {
        __moduleKey: 'mod/c',
        serverLoaders: { data: loader },
      },
    };

    // Resolver throws for unknown routeIds, simulating a route not in the manifest.
    const resolvePageUse = (_path: string) => {
      throw new Error('Route not registered: /protected');
    };
    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        resolvePageUse,
      })
    );

    const res = await post(app, {
      module: 'mod/c',
      loader: 'data',
      location: { path: '/protected', pathParams: {}, searchParams: {} },
    });

    expect(res.status).toBe(500);
    // The loader itself must never have run.
    expect(loaderFn).not.toHaveBeenCalled();
    // In dev the raw resolver message is surfaced to aid debugging.
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(
      "Route-bound loader '/protected' could not compose its middleware chain"
    );
    expect(body.error).toContain('Route not registered: /protected');
  });

  it('masks the raw resolver error message in production (dev: false)', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ secret: 'data' });
    const loader = _defineRouteLoader('/protected', loaderFn, {
      __moduleKey: 'mod/c',
      __loaderName: 'data',
    });
    const serverModules: Record<string, unknown> = {
      'mod/c': { __moduleKey: 'mod/c', serverLoaders: { data: loader } },
    };
    const resolvePageUse = () => {
      throw new Error('internal: dsn postgres://user:pw@host/db');
    };
    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: false, resolvePageUse })
    );

    const res = await post(app, {
      module: 'mod/c',
      loader: 'data',
      location: { path: '/protected', pathParams: {}, searchParams: {} },
    });

    expect(res.status).toBe(500);
    expect(loaderFn).not.toHaveBeenCalled();
    // The fixed message is present; the raw internal detail is NOT leaked.
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(
      "Route-bound loader '/protected' could not compose its middleware chain"
    );
    expect(body.error).not.toContain('postgres://');
    expect(body.error).not.toContain('internal:');
  });
});
