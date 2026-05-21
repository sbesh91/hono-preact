import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
} from '@hono-preact/iso';
import { loadersHandler } from '../loaders-handler.js';

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
});
