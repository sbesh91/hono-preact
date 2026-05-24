import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { pageActionHandler } from '../page-action-handler.js';
import { deny, redirect } from '@hono-preact/iso';

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
    resolvePageNode: () => null,
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
