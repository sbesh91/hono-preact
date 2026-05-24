import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { Hono } from 'hono';
import { pageActionHandler } from '../page-action-handler.js';
import { deny, redirect, defineAction, isTimeout } from '@hono-preact/iso';

function buildHandler(actions: Record<string, (ctx: unknown, payload: unknown) => Promise<unknown>>) {
  const resolverByPath = async () => {
    const map = new Map();
    for (const [name, fn] of Object.entries(actions)) {
      map.set(name, { fn, use: [], moduleKey: 'pages/test.server' });
    }
    return map;
  };
  const renderPage = vi.fn(async (c: { html: (s: string) => unknown }, _node: unknown) => c.html('<!doctype html><body>RENDERED</body>'));
  return pageActionHandler({
    resolverByPath,
    renderPage: renderPage as never,
    resolvePageNode: () => h('div', null),
    appConfig: { use: [] },
  });
}

describe('pageActionHandler', () => {
  it('returns __outcome=success JSON envelope on Accept: application/json', async () => {
    const handler = buildHandler({
      submit: async () => ({ id: 42 }),
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'submit', payload: { x: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ __outcome: 'success', data: { id: 42 } });
  });

  it('returns real 303 on Accept: text/html when action returns data', async () => {
    const handler = buildHandler({ submit: async () => ({ id: 42 }) });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/foo');
  });

  it('returns real 30x on Accept: text/html when action throws redirect()', async () => {
    const handler = buildHandler({
      submit: async () => {
        throw redirect('/next');
      },
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/next');
  });

  it('re-renders the page with deny outcome injected on Accept: text/html', async () => {
    const handler = buildHandler({
      submit: async () => {
        throw deny(422, 'bad', { data: { fieldErrors: { x: ['nope'] } } });
      },
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----b', Accept: 'text/html' },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('RENDERED');
  });

  it('returns 405 when streaming action invoked without Accept: text/event-stream', async () => {
    async function* gen() {
      yield { tick: 1 };
    }
    const handler = buildHandler({ stream: async () => gen() });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'stream', payload: {} }),
    });
    expect(res.status).toBe(405);
  });

  it('returns 404 when the action is not declared on the page chain', async () => {
    const handler = buildHandler({ submit: async () => 'ok' });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/test.server', action: 'missing', payload: {} }),
    });
    expect(res.status).toBe(404);
  });
});

// Helper that wires a single defineAction fn through pageActionHandler with
// timeout options, exercising per-action and handler-default timeout paths.
function buildTimedApp(
  actionFn: Parameters<typeof defineAction>[0],
  opts: { perActionTimeoutMs?: number | false; defaultTimeoutMs?: number | false }
) {
  const action = defineAction(actionFn, opts.perActionTimeoutMs !== undefined ? { timeoutMs: opts.perActionTimeoutMs } : undefined);
  const resolverByPath = async () => {
    const map = new Map();
    const metadata = action as unknown as { use?: ReadonlyArray<unknown>; timeoutMs?: number | false };
    map.set('create', {
      fn: action as (ctx: unknown, payload: unknown) => Promise<unknown>,
      use: metadata.use ?? [],
      timeoutMs: metadata.timeoutMs,
      moduleKey: 'pages/timed',
    });
    return map;
  };
  const noopRender = async () => new Response('', { status: 200 });
  const handler = pageActionHandler({
    resolverByPath,
    renderPage: noopRender as never,
    resolvePageNode: () => null,
    ...(opts.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: opts.defaultTimeoutMs } : {}),
  });
  const app = new Hono().post('*', handler);
  const post = (body: unknown) =>
    app.request('http://localhost/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, post };
}

describe('pageActionHandler timeouts', () => {
  it('returns a timeout outcome when the action exceeds its timeoutMs', async () => {
    const { post } = buildTimedApp(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return { id: 1 };
      },
      { perActionTimeoutMs: 50 }
    );

    const res = await post({ module: 'pages/timed', action: 'create', payload: {} });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses the handler default when the action has no timeoutMs', async () => {
    const { post } = buildTimedApp(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        return { ok: true };
      },
      { defaultTimeoutMs: 50 }
    );

    const res = await post({ module: 'pages/timed', action: 'create', payload: {} });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { timeoutMs: number };
    expect(isTimeout(body)).toBe(true);
    expect(body.timeoutMs).toBe(50);
  });

  it('disables the timeout when timeoutMs is false (even when defaultTimeoutMs is small)', async () => {
    const { post } = buildTimedApp(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        return { ok: true };
      },
      { perActionTimeoutMs: false, defaultTimeoutMs: 25 }
    );

    const res = await post({ module: 'pages/timed', action: 'create', payload: {} });
    expect(res.status).toBe(200);
  });

  it('signal.reason inside the action is a TimeoutError DOMException', async () => {
    let observedReason: unknown;
    const { post } = buildTimedApp(
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              observedReason = signal.reason;
              resolve();
            },
            { once: true }
          );
        });
        return { id: 0 };
      },
      { perActionTimeoutMs: 50 }
    );

    await post({ module: 'pages/timed', action: 'create', payload: {} });
    expect(observedReason).toBeInstanceOf(DOMException);
    expect((observedReason as DOMException).name).toBe('TimeoutError');
  });
});
