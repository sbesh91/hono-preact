import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
} from '@hono-preact/iso';
import { loadersHandler } from '../loaders-handler.js';
import { makePageUseResolvers } from '../route-server-modules.js';

describe('loaders-handler dispatches the full chain (root -> page -> unit)', () => {
  it('runs middleware in outer->inner order with appConfig + resolvePageUse + per-unit use', async () => {
    const calls: string[] = [];

    const root = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('root:before');
      await next();
      calls.push('root:after');
    });
    const page = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    const unit = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('unit:before');
      await next();
      calls.push('unit:after');
    });

    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [unit] }
    );

    const serverModules: Record<string, unknown> = {
      'test/m': {
        __moduleKey: 'test/m',
        serverLoaders: { l: loader },
      },
    };

    const appConfig = defineApp({ use: [root] });

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        appConfig,
        resolvePageUse: () => [page],
      })
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
    await expect(res.json()).resolves.toBe('ok');
    expect(calls).toEqual([
      'root:before',
      'page:before',
      'unit:before',
      'inner',
      'unit:after',
      'page:after',
      'root:after',
    ]);
  });

  it('makePageUseResolvers feeds pageUse into the chain by location path', async () => {
    const calls: string[] = [];
    const page = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });

    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'pages/p1', __loaderName: 'l' }
    );

    const serverModules: Record<string, unknown> = {
      'pages/p1.server.ts': {
        __moduleKey: 'pages/p1',
        pageUse: [page],
        serverLoaders: { l: loader },
      },
    };

    // The resolver pulls page-use from the same lazy modules the handler
    // consumes; here we declare a single route `/p1` whose server module is
    // the same record above. The handler awaits resolvePageUse so the lazy
    // build runs transparently on first request.
    const { byPath } = makePageUseResolvers([
      {
        path: '/p1',
        server: async () =>
          (serverModules as Record<string, unknown>)['pages/p1.server.ts'],
      },
    ]);

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        resolvePageUse: byPath,
      })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/p1',
        loader: 'l',
        location: { path: '/p1', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(['page:before', 'inner', 'page:after']);
  });

  it('makePageUseResolvers feeds pageUse into actions by module key', async () => {
    // Smoke-only: action-handler wiring is the symmetric path; we already
    // assert the loader-handler outer->inner chain above. This case proves
    // the byModuleKey lookup table is populated.
    const { byModuleKey } = makePageUseResolvers([
      {
        path: '/p2',
        server: async () => ({
          __moduleKey: 'pages/p2',
          pageUse: ['marker'],
        }),
      },
    ]);
    await expect(byModuleKey('pages/p2')).resolves.toEqual(['marker']);
    await expect(byModuleKey('nope')).resolves.toEqual([]);
  });

  it('matches parameterized leaf URLs against pattern paths', async () => {
    // Routes are declared with patterns (`/admin/users/:id`) but the
    // request carries the concrete URL the user navigated to
    // (`/admin/users/42`). The resolver must match pattern segments
    // against URL segments rather than relying on exact-string equality,
    // or per-page gating silently no-ops on every parameterized route.
    const { byPath } = makePageUseResolvers([
      {
        path: '/admin/users/:id',
        server: async () => ({
          __moduleKey: 'admin/users',
          pageUse: ['user-gate'],
        }),
      },
    ]);
    await expect(byPath('/admin/users/42')).resolves.toEqual(['user-gate']);
    await expect(byPath('/admin/users/abc/extra')).resolves.toEqual([]);
    await expect(byPath('/admin/users')).resolves.toEqual([]);
  });

  it('composes pageUse from layout ancestors down to the matched leaf', async () => {
    // Route tree:
    //   /admin          (layout .server.ts, pageUse = [adminGate])
    //   /admin/users/:id (leaf .server.ts,   pageUse = [auditLog])
    // A request to the leaf must run [adminGate, auditLog] -- the layout's
    // pageUse first, the leaf's pageUse second.
    const calls: string[] = [];
    const adminGate = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('admin:before');
      await next();
      calls.push('admin:after');
    });
    const auditLog = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('audit:before');
      await next();
      calls.push('audit:after');
    });

    const leafLoader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'admin/users', __loaderName: 'list' }
    );

    const adminServer = { __moduleKey: 'admin', pageUse: [adminGate] };
    const leafServer = {
      __moduleKey: 'admin/users',
      pageUse: [auditLog],
      serverLoaders: { list: leafLoader },
    };
    const serverModules: Record<string, unknown> = {
      'admin/layout.server.ts': adminServer,
      'admin/users/[id].server.ts': leafServer,
    };

    const { byPath } = makePageUseResolvers([
      { path: '/admin', server: async () => adminServer },
      { path: '/admin/users/:id', server: async () => leafServer },
    ]);

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true, resolvePageUse: byPath })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'admin/users',
        loader: 'list',
        location: {
          path: '/admin/users/42',
          pathParams: { id: '42' },
          searchParams: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'admin:before',
      'audit:before',
      'inner',
      'audit:after',
      'admin:after',
    ]);
  });

  it('byModuleKey returns the same composed array as byPath would', async () => {
    // Action handler routes by module key (which is unambiguous per
    // .server.* file). The result must include ancestor pageUse the same
    // way the loader path does, so an action call can never sneak past a
    // gate the URL path would have triggered.
    const adminServer = { __moduleKey: 'admin', pageUse: ['admin-gate'] };
    const leafServer = { __moduleKey: 'admin/users', pageUse: ['audit'] };
    const { byPath, byModuleKey } = makePageUseResolvers([
      { path: '/admin', server: async () => adminServer },
      { path: '/admin/users/:id', server: async () => leafServer },
    ]);
    await expect(byPath('/admin/users/42')).resolves.toEqual([
      'admin-gate',
      'audit',
    ]);
    await expect(byModuleKey('admin/users')).resolves.toEqual([
      'admin-gate',
      'audit',
    ]);
    // The layout's own module also composes (it has no ancestors with
    // pageUse here, so just its own).
    await expect(byModuleKey('admin')).resolves.toEqual(['admin-gate']);
  });
});
