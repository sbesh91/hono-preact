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
});
