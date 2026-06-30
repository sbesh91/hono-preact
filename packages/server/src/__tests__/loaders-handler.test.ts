import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { redirect, defineLoader } from '@hono-preact/iso';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { loadersHandler } from '../loaders-handler.js';

function makeApp(glob: Parameters<typeof loadersHandler>[0]) {
  const app = new Hono();
  app.post(
    '/__loaders',
    loadersHandler(glob, { resolvePageUse: async () => [] })
  );
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const loc = { path: '/movies', pathParams: {}, searchParams: {} };

describe('loadersHandler page-use resolver contract', () => {
  it('fails closed at construction when wired without a page-use resolver (auth-bypass regression)', () => {
    // Page-level `use` carries route/layout auth gates; on the loader RPC path
    // a missing resolver would silently drop them, exposing data the gate
    // should protect (a confidentiality bypass). resolvePageUse is required and
    // validated at construction, mirroring pageActionsHandler.
    const callWithoutOpts = loadersHandler as (glob: unknown) => unknown;
    expect(() => callWithoutOpts({})).toThrow(/resolvePageUse/);
  });
});

describe('loadersHandler', () => {
  it('calls the matching serverLoader with location, signal, and the Hono Context', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: loaderFn },
      },
    });

    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movies: [] });
    expect(loaderFn).toHaveBeenCalledWith(
      expect.objectContaining({
        location: loc,
        signal: expect.any(AbortSignal),
        c: expect.objectContaining({
          req: expect.anything(),
          header: expect.any(Function),
        }),
      })
    );
  });

  it('returns 404 when the module is not found', async () => {
    const res = await post(makeApp({}), {
      module: 'missing',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain(
      'not found'
    );
  });

  it('returns 404 when the module has no serverLoaders', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverActions: { create: vi.fn() },
      },
    });
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(404);
  });

  it('returns 500 with a sanitized message when the loader throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: {
          default: async () => {
            throw new Error('DB error: connection refused at 10.0.0.5');
          },
        },
      },
    });
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // Production behavior: no raw loader error text reaches the client.
    expect(body.error).toBe('Loader failed');
    expect(body.error).not.toContain('10.0.0.5');
  });

  it('leaks the raw error message to the client only when dev: true', async () => {
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/movies.server.ts': {
            __moduleKey: 'pages/movies',
            serverLoaders: {
              default: async () => {
                throw new Error('DB error: hostname leaked');
              },
            },
          },
        },
        { dev: true, resolvePageUse: async () => [] }
      )
    );
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DB error: hostname leaked');
  });

  it('calls onError with the real error and request context when a loader throws', async () => {
    const onError = vi.fn();
    const realErr = new Error('full PII');
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/movies.server.ts': {
            __moduleKey: 'pages/movies',
            serverLoaders: {
              default: async () => {
                throw realErr;
              },
            },
          },
        },
        { onError, resolvePageUse: async () => [] }
      )
    );
    await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(realErr, {
      module: 'pages/movies',
      loader: 'default',
    });
  });

  it('attributes a non-serializable finite return to the loader (onError + Loader failed)', async () => {
    // Serializing the value happens after the loader resolves; a BigInt (or a
    // circular ref) makes c.json throw. That is a loader-data fault, so it must
    // still fire onError and return the sanitized RPC envelope rather than fall
    // through to the default error handler.
    const onError = vi.fn();
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        {
          './pages/movies.server.ts': {
            __moduleKey: 'pages/movies',
            serverLoaders: {
              default: async () => ({ big: 10n }),
            },
          },
        },
        { onError, resolvePageUse: async () => [] }
      )
    );
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'Loader failed',
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
      module: 'pages/movies',
      loader: 'default',
    });
  });

  it('preserves deny.data in the loader RPC envelope', async () => {
    const { deny } = await import('@hono-preact/iso');
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: {
          default: async () => {
            throw deny(403, 'no', { data: { x: 1 } });
          },
        },
      },
    });
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      __outcome: string;
      message: string;
      data: unknown;
    };
    expect(body.__outcome).toBe('deny');
    expect(body.message).toBe('no');
    expect(body.data).toEqual({ x: 1 });
  });

  it('maps redirect() thrown from a loader to a redirect outcome envelope', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: {
          default: async () => {
            throw redirect('/login');
          },
        },
      },
    });
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    // 200 + envelope: the client RPC stub recognizes the outcome and
    // navigates; a thrown error here would fire user error boundaries
    // before the redirect.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { __outcome: string; to: string };
    expect(body.__outcome).toBe('redirect');
    expect(body.to).toBe('/login');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () =>
        Promise.resolve({
          __moduleKey: 'pages/movies',
          serverLoaders: { default: loaderFn },
        }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 400 when body is missing module field', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: vi.fn() },
      },
    });
    const res = await post(app, { loader: 'default', location: loc });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('module');
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () =>
        Promise.reject(new Error('load failed')),
    });
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain(
      'load failed'
    );
  });

  it('propagates location.searchParams through to the loader', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: loaderFn },
      },
    });
    const locWithParams = {
      path: '/movies',
      pathParams: {},
      searchParams: { genre: 'action' },
    };
    const res = await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: locWithParams,
    });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalledWith(
      expect.objectContaining({
        location: locWithParams,
        signal: expect.any(AbortSignal),
      })
    );
    const callArg = loaderFn.mock.calls[0][0] as {
      location: { searchParams: Record<string, string> };
    };
    expect(callArg.location.searchParams).toEqual({ genre: 'action' });
  });
});

describe('loadersHandler dev / caching', () => {
  it('caches the module map by default (dev defaults to false)', async () => {
    let resolves = 0;
    const lazy = async () => {
      resolves++;
      return {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: async () => ({ ok: true }) },
      };
    };
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        { './pages/movies.server.ts': lazy },
        {
          resolvePageUse: async () => [],
        }
      )
    );

    await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(resolves).toBe(1);
  });

  it('rebuilds the module map on every request when dev: true', async () => {
    let resolves = 0;
    const lazy = async () => {
      resolves++;
      return {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: async () => ({ ok: true }) },
      };
    };
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(
        { './pages/movies.server.ts': lazy },
        {
          dev: true,
          resolvePageUse: async () => [],
        }
      )
    );

    await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    await post(app, {
      module: 'pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(resolves).toBe(2);
  });
});

describe('loadersHandler path-keyed routing', () => {
  it('routes lookups by mod.__moduleKey rather than filename', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ id: 1 });
    // Filename and __moduleKey deliberately disagree to prove the
    // handler trusts the export, not the path.
    const app = makeApp({
      '/whatever.server.ts': {
        __moduleKey: 'src/pages/movies',
        serverLoaders: { default: loaderFn },
      },
    });
    const res = await post(app, {
      module: 'src/pages/movies',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 404 when the requested module key does not match any export', async () => {
    const app = makeApp({
      '/x.server.ts': {
        __moduleKey: 'a',
        serverLoaders: { default: async () => ({}) },
      },
    });
    const res = await post(app, {
      module: 'b',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(404);
  });

  it('skips modules that lack __moduleKey (defensive)', async () => {
    // A module without __moduleKey can't be routed; the handler should
    // simply not register it.
    const app = makeApp({
      '/no-key.server.ts': { serverLoaders: { default: async () => ({}) } },
    });
    const res = await post(app, {
      module: 'no-key',
      loader: 'default',
      location: loc,
    });
    expect(res.status).toBe(404);
  });
});

describe('loadersHandler: streaming', () => {
  it('frames a generator-returning loader as SSE', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverLoaders: {
          default: async function* () {
            yield { tick: 1 };
            yield { tick: 2 };
          },
        },
      },
    });

    const res = await post(app, {
      module: 'x',
      loader: 'default',
      location: { path: '/x', pathParams: {}, searchParams: {} },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('data: {"tick":1}');
    expect(body).toContain('data: {"tick":2}');
  });

  it('frames a ReadableStream<T>-returning loader as SSE', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverLoaders: {
          default: async () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue({ tick: 1 });
                controller.close();
              },
            }),
        },
      },
    });

    const res = await post(app, {
      module: 'x',
      loader: 'default',
      location: { path: '/x', pathParams: {}, searchParams: {} },
    });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('data: {"tick":1}');
  });
});

describe('loadersHandler: schema validation (searchSchema / paramsSchema)', () => {
  const numericId: StandardSchemaV1<{ id: string }, { id: number }> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (v) => {
        const id = Number((v as { id: unknown }).id);
        return Number.isInteger(id)
          ? { value: { id } }
          : { issues: [{ message: 'id must be an integer', path: ['id'] }] };
      },
    },
  };
  const minPage: StandardSchemaV1<{ page: string }, { page: number }> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (v) => {
        const page = Number((v as { page: unknown }).page);
        return page >= 1
          ? { value: { page } }
          : { issues: [{ message: 'page must be >= 1', path: ['page'] }] };
      },
    },
  };

  function globWith(loader: unknown) {
    return {
      './x.server.ts': {
        __moduleKey: 'pages/x.server',
        serverLoaders: { default: loader },
      },
    };
  }

  it('coerces searchParams via searchSchema and passes them to the loader', async () => {
    let seen: unknown;
    const ref = defineLoader(
      async (ctx) => {
        seen = ctx.location.searchParams;
        return 'ok';
      },
      { searchSchema: minPage }
    );
    const handler = loadersHandler(globWith(ref), {
      resolvePageUse: async () => [],
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/x.server',
        loader: 'default',
        location: { path: '/x', pathParams: {}, searchParams: { page: '3' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ page: 3 });
  });

  it('returns 400 when searchSchema fails', async () => {
    const ref = defineLoader(async () => 'ok', { searchSchema: minPage });
    const handler = loadersHandler(globWith(ref), {
      resolvePageUse: async () => [],
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/x.server',
        loader: 'default',
        location: { path: '/x', pathParams: {}, searchParams: { page: '0' } },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when paramsSchema fails', async () => {
    const ref = defineLoader(async () => 'ok', { paramsSchema: numericId });
    const handler = loadersHandler(globWith(ref), {
      resolvePageUse: async () => [],
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/x.server',
        loader: 'default',
        location: {
          path: '/x/abc',
          pathParams: { id: 'abc' },
          searchParams: {},
        },
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe('loadersHandler: location validation', () => {
  it('rejects missing location', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverLoaders: { default: async () => ({}) },
      },
    });
    const res = await post(app, { module: 'x', loader: 'default' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/location/);
  });

  it('rejects location missing path or pathParams', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverLoaders: { default: async () => ({}) },
      },
    });
    const res = await post(app, {
      module: 'x',
      loader: 'default',
      location: { searchParams: {} },
    });
    expect(res.status).toBe(400);
  });
});
