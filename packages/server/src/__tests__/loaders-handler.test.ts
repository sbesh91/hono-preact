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

const loc = { path: '/movies', pathParams: {}, query: {} };

describe('loadersHandler', () => {
  it('calls the matching serverLoader with the location and returns JSON', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': { default: loaderFn },
    });

    const res = await post(app, { module: 'movies', location: loc });

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
      './pages/movies.server.ts': { serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the loader throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        default: async () => { throw new Error('DB error'); },
      },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('DB error');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () => Promise.resolve({ default: loaderFn }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 400 when body is missing module field', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { default: vi.fn() },
    });
    const res = await post(app, { location: loc });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('module');
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () => Promise.reject(new Error('load failed')),
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('load failed');
  });

  it('derives module name by stripping path and .server.* extension', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './src/pages/movies.server.tsx': { default: loaderFn },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(200);
  });
});
