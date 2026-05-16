import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';

function makeApp(glob: Parameters<typeof loadersHandler>[0]) {
  const app = new Hono();
  app.post('/__loaders', loadersHandler(glob));
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

describe('loadersHandler', () => {
  it('calls the matching serverLoader with location, signal, and the Hono Context', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: loaderFn },
      },
    });

    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });

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
    const res = await post(makeApp({}), { module: 'missing', loader: 'default', location: loc });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("not found");
  });

  it('returns 404 when the module has no serverLoaders', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverActions: { create: vi.fn() },
      },
    });
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    expect(res.status).toBe(404);
  });

  it('returns 500 with a sanitized message when the loader throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: { default: async () => { throw new Error('DB error: connection refused at 10.0.0.5'); } },
      },
    });
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
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
            serverLoaders: { default: async () => { throw new Error('DB error: hostname leaked'); } },
          },
        },
        { dev: true }
      )
    );
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
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
            serverLoaders: { default: async () => { throw realErr; } },
          },
        },
        { onError }
      )
    );
    await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(realErr, { module: 'pages/movies', loader: 'default' });
  });

  it('maps GuardRedirect thrown from a loader to a __redirect envelope', async () => {
    const { GuardRedirect } = await import('@hono-preact/iso');
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        serverLoaders: {
          default: async () => { throw new GuardRedirect('/login'); },
        },
      },
    });
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    // 200 + envelope: the client RPC stub recognizes __redirect and navigates;
    // a thrown error here would fire user error boundaries before the redirect.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ __redirect: '/login' });
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

    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
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
    expect((await res.json() as { error: string }).error).toContain('module');
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () => Promise.reject(new Error('load failed')),
    });
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('load failed');
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
    const res = await post(app, { module: 'pages/movies', loader: 'default', location: locWithParams });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalledWith(
      expect.objectContaining({ location: locWithParams, signal: expect.any(AbortSignal) })
    );
    const callArg = loaderFn.mock.calls[0][0] as { location: { searchParams: Record<string, string> } };
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
    app.post('/__loaders', loadersHandler({ './pages/movies.server.ts': lazy }));

    await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    await post(app, { module: 'pages/movies', loader: 'default', location: loc });
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
      loadersHandler({ './pages/movies.server.ts': lazy }, { dev: true })
    );

    await post(app, { module: 'pages/movies', loader: 'default', location: loc });
    await post(app, { module: 'pages/movies', loader: 'default', location: loc });
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
      '/x.server.ts': { __moduleKey: 'a', serverLoaders: { default: async () => ({}) } },
    });
    const res = await post(app, { module: 'b', loader: 'default', location: loc });
    expect(res.status).toBe(404);
  });

  it('skips modules that lack __moduleKey (defensive)', async () => {
    // A module without __moduleKey can't be routed; the handler should
    // simply not register it.
    const app = makeApp({
      '/no-key.server.ts': { serverLoaders: { default: async () => ({}) } },
    });
    const res = await post(app, { module: 'no-key', loader: 'default', location: loc });
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
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/location/);
  });

  it('rejects location missing path or pathParams', async () => {
    const app = makeApp({
      './pages/x.server.ts': {
        __moduleKey: 'x',
        serverLoaders: { default: async () => ({}) },
      },
    });
    const res = await post(app, { module: 'x', loader: 'default', location: { searchParams: {} } });
    expect(res.status).toBe(400);
  });
});
