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
  it('calls the matching serverLoader with the location and returns JSON', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': { __moduleKey: 'pages/movies', default: loaderFn },
    });

    const res = await post(app, { module: 'pages/movies', location: loc });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movies: [] });
    expect(loaderFn).toHaveBeenCalledWith({ location: loc });
  });

  it('returns 404 when the module is not found', async () => {
    const res = await post(makeApp({}), { module: 'missing', location: loc });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Module 'missing' not found");
  });

  it('returns 404 when the module has no default export', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { __moduleKey: 'pages/movies', serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { module: 'pages/movies', location: loc });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the loader throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        __moduleKey: 'pages/movies',
        default: async () => { throw new Error('DB error'); },
      },
    });
    const res = await post(app, { module: 'pages/movies', location: loc });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('DB error');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () => Promise.resolve({ __moduleKey: 'pages/movies', default: loaderFn }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, { module: 'pages/movies', location: loc });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 400 when body is missing module field', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { __moduleKey: 'pages/movies', default: vi.fn() },
    });
    const res = await post(app, { location: loc });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('module');
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () => Promise.reject(new Error('load failed')),
    });
    const res = await post(app, { module: 'pages/movies', location: loc });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('load failed');
  });

  it('propagates location.searchParams through to the loader', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': { __moduleKey: 'pages/movies', default: loaderFn },
    });
    const locWithParams = {
      path: '/movies',
      pathParams: {},
      searchParams: { genre: 'action' },
    };
    const res = await post(app, { module: 'pages/movies', location: locWithParams });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalledWith({ location: locWithParams });
    const callArg = loaderFn.mock.calls[0][0] as { location: { searchParams: Record<string, string> } };
    expect(callArg.location.searchParams).toEqual({ genre: 'action' });
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
        default: loaderFn,
      },
    });
    const res = await post(app, {
      module: 'src/pages/movies',
      location: loc,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 404 when the requested module key does not match any export', async () => {
    const app = makeApp({
      '/x.server.ts': { __moduleKey: 'a', default: async () => ({}) },
    });
    const res = await post(app, { module: 'b', location: loc });
    expect(res.status).toBe(404);
  });

  it('skips modules that lack __moduleKey (defensive)', async () => {
    // A module without __moduleKey can't be routed; the handler should
    // simply not register it.
    const app = makeApp({
      '/no-key.server.ts': { default: async () => ({}) },
    });
    const res = await post(app, { module: 'no-key', location: loc });
    expect(res.status).toBe(404);
  });
});
