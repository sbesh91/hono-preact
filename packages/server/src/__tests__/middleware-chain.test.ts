import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
  defineStreamObserver,
} from '@hono-preact/iso';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionHandler } from '../page-action-handler.js';
import { makePageActionResolvers } from '../page-action-resolvers.js';

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

describe('stream observer fanout (E20)', () => {
  it('fires onStart, onChunk per yield, and onEnd on a streaming loader through loadersHandler', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, void>({
      onStart: () => events.push('start'),
      onChunk: (_ctx, chunk, i) => events.push(`chunk:${i}:${chunk}`),
      onEnd: (_ctx, info) => events.push(`end:${info.chunks}`),
      onError: () => events.push('error'),
      onAbort: () => events.push('abort'),
    });

    const streamLoader = defineLoader<number>(
      async function* () {
        yield 10;
        yield 20;
        yield 30;
      },
      { __moduleKey: 'mod', __loaderName: 's', use: [observer] }
    );

    const serverModules: Record<string, unknown> = {
      mod: {
        __moduleKey: 'mod',
        serverLoaders: { s: streamLoader },
      },
    };

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true })
    );
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'mod',
        loader: 's',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    // Drain the body so the SSE pump completes.
    await res.text();

    expect(events).toEqual([
      'start',
      'chunk:0:10',
      'chunk:1:20',
      'chunk:2:30',
      'end:3',
    ]);
  });

  it('fires onStart, onChunk per yield, and onEnd on a streaming action through pageActionHandler', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, { ok: true }>({
      onStart: () => events.push('start'),
      onChunk: (_ctx, chunk, i) => events.push(`chunk:${i}:${chunk}`),
      onEnd: (_ctx, info) => events.push(`end:${info.chunks}`),
      onError: () => events.push('error'),
    });

    async function* streamAction(): AsyncGenerator<
      number,
      { ok: true },
      unknown
    > {
      yield 1;
      yield 2;
      return { ok: true };
    }
    const wrapped = streamAction as typeof streamAction & {
      use?: ReadonlyArray<unknown>;
    };
    wrapped.use = [observer];

    const serverModule = {
      __moduleKey: 'mod',
      serverActions: { do: wrapped },
    };
    const serverRoutes = [
      {
        path: '/page',
        server: async () => serverModule,
        ancestors: [],
      },
    ];
    const resolvers = makePageActionResolvers(serverRoutes, { dev: true });
    const noopRender = async () => new Response('', { status: 200 });

    const app = new Hono().post(
      '*',
      pageActionHandler({
        resolverByPath: resolvers.byPath,
        resolvePageUseByPath: async () => [], // streaming-observer fixture, no page-level middleware
        renderPage: noopRender as never,
        resolvePageNode: () => null,
      })
    );
    const res = await app.request('/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ module: 'mod', action: 'do', payload: null }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(events).toEqual(['start', 'chunk:0:1', 'chunk:1:2', 'end:2']);
  });

  it('fires onError when a streaming loader throws partway', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, void>({
      onStart: () => events.push('start'),
      onChunk: (_c, ch) => events.push(`chunk:${ch}`),
      onError: (_c, err, info) =>
        events.push(`error:${(err as Error).message}:${info.chunks}`),
    });

    const streamLoader = defineLoader<number>(
      async function* () {
        yield 1;
        throw new Error('boom');
      },
      { __moduleKey: 'mod', __loaderName: 's', use: [observer] }
    );

    const serverModules: Record<string, unknown> = {
      mod: {
        __moduleKey: 'mod',
        serverLoaders: { s: streamLoader },
      },
    };

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true })
    );
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'mod',
        loader: 's',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(events).toEqual(['start', 'chunk:1', 'error:boom:1']);
  });
});

describe('pageActionHandler dispatches the full chain (root -> page -> action)', () => {
  it('runs page-level middleware before the action body (regression: page-level was previously dropped)', async () => {
    // Without resolvePageUseByPath the old handler only composed
    // [appUse, actionUse], silently dropping pageUse. Any user who guards a
    // page with pageUse (e.g. an auth gate on a layout .server.ts) would have
    // seen action POSTs bypass the gate. This test locks in the fix.
    const order: string[] = [];

    const pageMw = defineServerMiddleware<'action'>(async (_ctx, next) => {
      order.push('page-in');
      await next();
      order.push('page-out');
    });

    const handler = pageActionHandler({
      resolverByPath: async () => {
        const map = new Map<
          string,
          {
            fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
            use: ReadonlyArray<unknown>;
            moduleKey: string;
          }
        >();
        map.set('submit', {
          fn: async () => {
            order.push('action');
            return { ok: true };
          },
          use: [],
          moduleKey: 'pages/test.server',
        });
        return map;
      },
      resolvePageUseByPath: async () => [pageMw],
      renderPage: async () => new Response('', { status: 200 }),
      resolvePageNode: () => null,
      appConfig: { use: [] },
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
    expect(order).toEqual(['page-in', 'action', 'page-out']);
  });

  it('runs root -> page -> action in correct order with all three layers', async () => {
    const order: string[] = [];

    const rootMw = defineServerMiddleware<'action'>(async (_ctx, next) => {
      order.push('root-in');
      await next();
      order.push('root-out');
    });
    const pageMw = defineServerMiddleware<'action'>(async (_ctx, next) => {
      order.push('page-in');
      await next();
      order.push('page-out');
    });
    const actionMw = defineServerMiddleware<'action'>(async (_ctx, next) => {
      order.push('action-mw-in');
      await next();
      order.push('action-mw-out');
    });

    const handler = pageActionHandler({
      resolverByPath: async () => {
        const map = new Map<
          string,
          {
            fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
            use: ReadonlyArray<unknown>;
            moduleKey: string;
          }
        >();
        map.set('submit', {
          fn: async () => {
            order.push('inner');
            return { ok: true };
          },
          use: [actionMw],
          moduleKey: 'pages/test.server',
        });
        return map;
      },
      resolvePageUseByPath: async () => [pageMw],
      renderPage: async () => new Response('', { status: 200 }),
      resolvePageNode: () => null,
      appConfig: { use: [rootMw] },
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
    expect(order).toEqual([
      'root-in',
      'page-in',
      'action-mw-in',
      'inner',
      'action-mw-out',
      'page-out',
      'root-out',
    ]);
  });

  it('fails closed at construction when wired without a page-use resolver (auth-bypass regression)', () => {
    // Previously resolvePageUseByPath was optional and the handler fell back to
    // an empty page-use array, silently composing only [appUse, actionUse]. A
    // page-level auth gate on a layout .server.ts was therefore bypassed on the
    // action POST path. The resolver is now required and validated at
    // construction, so a mis-wired handler fails loudly instead of running the
    // action with its page-level (auth) middleware silently dropped.
    const make = () =>
      pageActionHandler({
        resolverByPath: async () =>
          new Map([
            [
              'submit',
              {
                fn: async () => ({ ok: true }),
                use: [],
                moduleKey: 'pages/test.server',
              },
            ],
          ]),
        // resolvePageUseByPath omitted to simulate a mis-wired (e.g. JS) caller
        renderPage: async () => new Response('', { status: 200 }),
        resolvePageNode: () => null,
      } as unknown as Parameters<typeof pageActionHandler>[0]);

    expect(make).toThrow(/resolvePageUseByPath/);
  });
});
