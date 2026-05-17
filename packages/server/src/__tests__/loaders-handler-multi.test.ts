import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';
import { defineLoader } from '@hono-preact/iso';

describe('loadersHandler: serverLoaders dispatch', () => {
  const fakeModule = {
    __moduleKey: 'pages/movie',
    serverLoaders: {
      summary: async ({ location }: any) => ({
        kind: 'summary',
        id: location.pathParams.id,
      }),
      cast: async ({ location }: any) => ({
        kind: 'cast',
        id: location.pathParams.id,
      }),
    },
  };

  const glob = { './pages/movie.server.ts': fakeModule };

  it('dispatches to summary by composite key', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'summary',
        location: {
          path: '/movies/9',
          pathParams: { id: '9' },
          searchParams: {},
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ kind: 'summary', id: '9' });
  });

  it('dispatches to cast by composite key', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'cast',
        location: {
          path: '/movies/9',
          pathParams: { id: '9' },
          searchParams: {},
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ kind: 'cast', id: '9' });
  });

  it('returns 404 for unknown loader name', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'nonexistent',
        location: {
          path: '/movies/9',
          pathParams: { id: '9' },
          searchParams: {},
        },
      }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when loader field is missing', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        location: {
          path: '/movies/9',
          pathParams: { id: '9' },
          searchParams: {},
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('dispatches when serverLoaders entries are LoaderRef objects from defineLoader', async () => {
    // Real user code wraps loaders in `defineLoader(fn)` so they carry
    // moduleKey/cache/etc. The handler must unwrap `.fn` from the ref to
    // get the callable; otherwise every reload via `/__loaders` returns
    // 404 with "Loader 'module::name' not found".
    const module = {
      __moduleKey: 'pages/watched',
      serverLoaders: {
        default: defineLoader(async () => ({ entries: [{ id: 1 }] }), {
          __moduleKey: 'pages/watched',
          __loaderName: 'default',
        }),
      },
    };
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler({ './pages/watched.server.ts': module } as any)
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/watched',
        loader: 'default',
        location: { path: '/watched', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ entries: [{ id: 1 }] });
  });
});
