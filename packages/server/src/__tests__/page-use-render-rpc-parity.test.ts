import { describe, it, expect } from 'vitest';
import { h, type ComponentChildren } from 'preact';
import { defineRoutes, defineServerMiddleware, deny } from '@hono-preact/iso';
import { _defineRouteLoader } from '@hono-preact/iso/internal';
import { createServerEntry } from '../create-server-entry.js';

// RouteDef.use is documented as ONE declaration enforced on the page render
// (SSR + client nav) and on the loader/action RPC paths. Those are two
// independent implementations (withLeafGuard -> PageMiddlewareHost for render,
// makePageUseResolver -> composeServerChain for RPC), so nothing structurally
// ties them together. This pairs them: the SAME route-level server guard must
// stop both, so drift in either path fails a test instead of shipping.
//
// The manifest MUST come from defineRoutes: a hand-built RoutesManifest can
// populate routeUse (the RPC lookup) while tree/flat never go through the
// walker that applies withLeafGuard, which would look like a render-path
// failure but is only a malformed fixture.

const Layout = ({ children }: { children?: ComponentChildren }) =>
  h('div', null, children);

function setup() {
  const ran = { guard: 0, loader: 0, view: 0 };
  const guard = defineServerMiddleware(async () => {
    ran.guard++;
    throw deny(403, 'no entry');
  });
  const loader = _defineRouteLoader(
    '/area',
    async () => {
      ran.loader++;
      return 'secret';
    },
    { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
  );
  const routes = defineRoutes([
    {
      path: '/area',
      use: [guard],
      view: async () => ({
        default: () => {
          ran.view++;
          return h('p', null, 'SECRET-VIEW');
        },
      }),
    },
  ]);
  const app = createServerEntry({
    routes: {
      ...routes,
      serverImports: [
        async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
      ],
    },
    layout: Layout,
    dev: true,
  });
  return { app, ran };
}

describe('route `use` guard: render and RPC paths agree', () => {
  it('stops the SSR render of the guarded route', async () => {
    const { app, ran } = setup();
    const res = await app.request('/area');
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET-VIEW');
    expect(ran.guard).toBeGreaterThan(0);
    expect(ran.view).toBe(0);
  });

  it('stops the loader RPC for the same route with the same outcome', async () => {
    const { app, ran } = setup();
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/area', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(403);
    expect(ran.guard).toBe(1);
    expect(ran.loader).toBe(0);
  });
});
