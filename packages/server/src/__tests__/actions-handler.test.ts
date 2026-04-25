import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { actionsHandler } from '../actions-handler.js';

function makeApp(glob: Parameters<typeof actionsHandler>[0]) {
  const app = new Hono();
  app.post('/__actions', actionsHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postFormData(app: Hono, formData: FormData) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    body: formData,
  });
}

describe('actionsHandler', () => {
  it('calls the matching action with the Hono context and payload', async () => {
    const createFn = vi.fn().mockResolvedValue({ id: 1 });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: createFn } },
    });

    const res = await post(app, {
      module: 'movies',
      action: 'create',
      payload: { title: 'Dune' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ req: expect.anything() }),
      { title: 'Dune' }
    );
  });

  it('returns 404 when the module is not found', async () => {
    const res = await post(makeApp({}), {
      module: 'missing',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Module 'missing' not found");
  });

  it('returns 404 when the action is not found in the module', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { module: 'movies', action: 'destroy', payload: {} });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Action 'destroy' not found");
  });

  it('returns 500 when the action throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: {
          create: async () => {
            throw new Error('DB error');
          },
        },
      },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('DB error');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const createFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () =>
        Promise.resolve({ serverActions: { create: createFn } }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
    expect(createFn).toHaveBeenCalled();
  });

  it('ignores modules without serverActions', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverLoader: async () => ({}) },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(404);
  });

  it('derives module name by stripping path and .server.* extension', async () => {
    const createFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './src/pages/movies.server.tsx': { serverActions: { create: createFn } },
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(200);
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () => Promise.reject(new Error('load failed')),
    });
    const res = await post(app, { module: 'movies', action: 'create', payload: {} });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('load failed');
  });

  it('returns 400 when body is missing module or action fields', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { payload: {} });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('module');
  });

  it('pipes ReadableStream return value as text/event-stream', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"progress":50}\n'));
        controller.enqueue(encoder.encode('{"progress":100}\n'));
        controller.close();
      },
    });

    const app = makeApp({
      './pages/movies.server.ts': {
        serverActions: { process: async () => stream },
      },
    });

    const res = await post(app, { module: 'movies', action: 'process', payload: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('{"progress":50}');
    expect(body).toContain('{"progress":100}');
  });
});

describe('actionsHandler — multipart/form-data', () => {
  it('dispatches action from multipart form data with __module and __action fields', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('title', 'Dune');

    const res = await postFormData(app, fd);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.title).toBe('Dune');
  });

  it('surfaces File objects in the action payload', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ stored: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('poster', new File(['<binary>'], 'poster.jpg', { type: 'image/jpeg' }));

    const res = await postFormData(app, fd);
    expect(res.status).toBe(200);
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.poster).toBeInstanceOf(File);
    expect((payload.poster as File).name).toBe('poster.jpg');
  });

  it('returns 400 when __module or __action is missing from form data', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: vi.fn() } },
    });
    const fd = new FormData();
    fd.append('title', 'Dune');

    const res = await postFormData(app, fd);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('__module');
  });

  it('collects repeated form field names into an array', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('tag', 'sci-fi');
    fd.append('tag', 'drama');

    await postFormData(app, fd);
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.tag).toEqual(['sci-fi', 'drama']);
  });
});
