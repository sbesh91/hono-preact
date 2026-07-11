import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { h, type ComponentChildren } from 'preact';
import {
  defineServerMiddleware,
  defineLoader,
  type RoutesManifest,
} from '@hono-preact/iso';
import { _defineRouteLoader } from '@hono-preact/iso/internal';
import { createServerEntry } from '../create-server-entry.js';

// A minimal RoutesManifest sufficient for the loader RPC path. The SSR (GET)
// and action paths are exercised end-to-end by the dogfood site build and the
// integration suite; these unit tests target the wiring guarantees that the
// generated entry used to verify only indirectly via generated-string asserts.
function manifest(
  parts: Partial<RoutesManifest> &
    Pick<RoutesManifest, 'serverImports' | 'routeUse'>
): RoutesManifest {
  return {
    tree: [],
    flat: [],
    serverRoutes: [],
    ...parts,
  };
}

// A trivial layout so createServerEntry's tree closure typechecks; the loader
// RPC and api-mount tests never render it.
const Layout = ({ children }: { children?: ComponentChildren }) =>
  h('div', null, children);

describe('createServerEntry', () => {
  it('threads the manifest routeUse page guard onto the loader RPC path (issue #122 parity)', async () => {
    const calls: string[] = [];
    const pageGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    // _defineRouteLoader marks this as route-bound so the handler resolves its
    // page guards from the declared route (/x) rather than skipping the page tier.
    const loader = _defineRouteLoader(
      '/x',
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [pageGuard] }],
      }),
      layout: Layout,
      dev: true,
    });

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
    await expect(res.json()).resolves.toBe('ok');
    // The page guard from manifest.routeUse ran around the loader: proof that
    // createServerEntry wired makePageUseResolver(routes).byPath into the
    // loaders handler rather than composing a guard-less chain.
    expect(calls).toEqual(['page:before', 'inner', 'page:after']);
  });

  it('mounts the api app ahead of the reserved /__loaders path', async () => {
    let loadersRan = false;
    const blocked = defineServerMiddleware<'loader'>(async () => {});

    const api = new Hono();
    api.use('*', async (c, next) => {
      // Reject everything so we can prove the api layer runs first.
      if (new URL(c.req.url).pathname === '/__loaders') {
        return c.text('blocked-by-api', 403);
      }
      await next();
    });

    const loader = defineLoader<string>(
      async () => {
        loadersRan = true;
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [blocked] }],
      }),
      layout: Layout,
      api,
      dev: true,
    });

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toBe('blocked-by-api');
    expect(loadersRan).toBe(false);
  });

  it('works without an api app', async () => {
    const loader = defineLoader<string>(async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [],
      }),
      layout: Layout,
      dev: true,
    });
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
    await expect(res.json()).resolves.toBe('ok');
  });

  it('fails closed (500) when a route-bound unit declares a route other than its mount', async () => {
    // A route-bound action stamped with a `__routeId` that does not match the
    // route its module is registered on: the binding guard must reject the POST
    // rather than let it resolve its page-use (auth) chain from the wrong route.
    const action = Object.defineProperty(async () => 'ok', '__routeId', {
      value: '/wrong',
      enumerable: false,
    });
    const serverThunk = async () => ({
      __moduleKey: 'test/m',
      serverActions: { go: action },
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [serverThunk],
        routeUse: [{ path: '/right', use: [] }],
        serverRoutes: [
          { path: '/right', ancestors: [], server: serverThunk } as never,
        ],
      }),
      layout: Layout,
      dev: true,
    });
    const res = await app.request('/right', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'test/m', action: 'go', payload: {} }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("bound to route '/wrong'");
    expect(body.message).toContain("registered on route '/right'");
  });

  it('passes the binding guard when a route-bound unit matches its mount', async () => {
    const loader = _defineRouteLoader('/right', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const serverThunk = async () => ({
      __moduleKey: 'test/m',
      serverLoaders: { l: loader },
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [serverThunk],
        routeUse: [{ path: '/right', use: [] }],
        serverRoutes: [
          { path: '/right', ancestors: [], server: serverThunk } as never,
        ],
      }),
      layout: Layout,
      dev: true,
    });
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/right', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe('ok');
  });

  it('wires the bare-loader guarded-route dev warning (dev: true)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pageGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
        await next();
      });
      const app = createServerEntry({
        routes: manifest({
          serverImports: [
            async () => ({
              __moduleKey: 'test/bare',
              serverLoaders: { l: async () => 'ok' },
            }),
          ],
          routeUse: [{ path: '/x', use: [pageGuard] }],
        }),
        layout: Layout,
        dev: true,
      });
      const res = await app.request('/__loaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'test/bare',
          loader: 'l',
          location: { path: '/x', pathParams: {}, searchParams: {} },
        }),
      });
      expect(res.status).toBe(200);
      const warnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes('bare loader')
      );
      expect(warnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('aliased exact layout binding dev warning', () => {
  const buildApp = (dev: boolean) => {
    const layoutGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const indexGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const loader = _defineRouteLoader('/x', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const mod = { __moduleKey: 'test/m', serverLoaders: { l: loader } };
    return createServerEntry({
      routes: manifest({
        serverImports: [async () => mod],
        serverRoutes: [{ path: '/x', server: async () => mod, ancestors: [] }],
        routeUse: [
          { path: '/x', use: [layoutGate, indexGate] },
          { path: '/x/*', use: [layoutGate] },
        ],
      }),
      layout: Layout,
      dev,
    });
  };
  const post = (app: ReturnType<typeof buildApp>) =>
    app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
  const aliasWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
    calls.filter((c) => String(c[0]).includes('page scope'));

  it('dev warns once per binding across requests, naming both spellings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(true);
      await post(app);
      await post(app);
      const warnings = aliasWarnings(warn.mock.calls);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0][0])).toContain("serverRoute('/x/*')");
    } finally {
      warn.mockRestore();
    }
  });

  it('prod never warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(false);
      await post(app);
      expect(aliasWarnings(warn.mock.calls)).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
