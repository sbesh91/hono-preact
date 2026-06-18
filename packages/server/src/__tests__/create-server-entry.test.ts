import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { h, type ComponentChildren } from 'preact';
import {
  defineServerMiddleware,
  defineLoader,
  type RoutesManifest,
} from '@hono-preact/iso';
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
    const loader = defineLoader<string>(
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
});
