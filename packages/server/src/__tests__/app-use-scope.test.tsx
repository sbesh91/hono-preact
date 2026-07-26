import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { RouteHook } from 'preact-iso';
import { defineApp, defineServerMiddleware } from '@hono-preact/iso';
import { _defineRouteLoader } from '@hono-preact/iso/internal';
import { renderPage } from '../render.js';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionsHandler } from '../page-actions-handler.js';

/**
 * ONE app-level middleware, driven down all three server paths.
 *
 * `AppConfig['use']` is dispatched by three different call sites --
 * `render.tsx`'s root dispatch, `loadersHandler`, and `pageActionsHandler`
 * (the latter two via `composeServerChain`, which folds `appConfig.use` in as
 * the outermost tier of every chain). That is what "app-level" means: an
 * app-tier guard runs on every request, not just page renders.
 *
 * The type has to say so, which is why `AppUseElement` admits only all-scope
 * `ServerMiddleware<Scope>`. This test pins the runtime half of that contract,
 * so a future narrowing of any of the three dispatch sites (which would drop an
 * app-tier auth gate off the loader or action path) fails here.
 */
function Page() {
  return (
    <html>
      <head></head>
      <body>
        <div>page</div>
      </body>
    </html>
  );
}

type Seen = { scope: string; hasLocation: boolean };

// `ctx.location` is present on page and loader ctx and OPTIONAL on action ctx
// (a bare `defineAction` is route-independent, so there is no
// route-authoritative URL to hand a guard). Off the all-scope ctx it therefore
// reads as `RouteHook | undefined`, which is the check an app-tier guard has to
// make -- and exactly what the old `ServerMiddleware<'page'>` typing, promising
// a `location` that is always present, let an author skip.
function recorder(seen: Seen[]) {
  return defineServerMiddleware(async (ctx, next) => {
    const location: RouteHook | undefined = ctx.location;
    seen.push({ scope: ctx.scope, hasLocation: location !== undefined });
    await next();
  });
}

describe('app-level `use` is dispatched in every scope', () => {
  it('observes page scope on a page render', async () => {
    const seen: Seen[] = [];
    const appConfig = defineApp({ use: [recorder(seen)] });
    const app = new Hono().get('*', (c) =>
      renderPage(c, <Page />, { appConfig })
    );

    const res = await app.request('http://localhost/x?q=1');
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ scope: 'page', hasLocation: true }]);
  });

  it('observes loader scope on a loader RPC', async () => {
    const seen: Seen[] = [];
    const loader = _defineRouteLoader('/x', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const app = new Hono().post(
      '/__loaders',
      loadersHandler(
        { 'test/m': { __moduleKey: 'test/m', serverLoaders: { l: loader } } },
        {
          dev: true,
          appConfig: defineApp({ use: [recorder(seen)] }),
          resolvePageUse: () => [],
        }
      )
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ scope: 'loader', hasLocation: true }]);
  });

  it('observes action scope, with NO location, on a bare action POST', async () => {
    const seen: Seen[] = [];
    const handler = pageActionsHandler({
      resolverByPath: async () => {
        const map = new Map<
          string,
          {
            fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
            use: ReadonlyArray<unknown>;
            moduleKey: string;
            routeId?: string;
          }
        >();
        // No `routeId`: a BARE action, route-independent, so the ctx carries
        // no `location`. An app-tier guard reading `ctx.location.pathParams`
        // here would throw -- the hazard the old page-scope typing hid.
        map.set('submit', {
          fn: async () => ({ ok: true }),
          use: [],
          moduleKey: 'pages/test.server',
        });
        return map;
      },
      resolvePageUseByPattern: async () => [],
      renderPage: async () => new Response('', { status: 200 }),
      resolvePageNode: () => null,
      appConfig: defineApp({ use: [recorder(seen)] }),
    });

    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'submit',
        payload: {},
      }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ scope: 'action', hasLocation: false }]);
  });
});
