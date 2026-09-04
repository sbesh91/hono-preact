import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { h } from 'preact';
import { defineServerMiddleware, type AppConfig } from '@hono-preact/iso';
import { publishToChannel, CHANNEL_HEADER } from '@hono-preact/iso/internal';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionsHandler } from '../page-actions-handler.js';

const loc = { path: '/movies', pathParams: {}, searchParams: {} };

function publishingGate() {
  return defineServerMiddleware(async (_ctx, next) => {
    publishToChannel('demo', { signedIn: true });
    await next();
  });
}

function makeLoadersApp(appConfig: AppConfig) {
  const app = new Hono();
  app.post(
    '/__loaders',
    loadersHandler(
      {
        './pages/movies.server.ts': {
          __moduleKey: 'pages/movies',
          serverLoaders: {
            default: async () => ({ movies: [] }),
            stream: async function* () {
              yield { tick: 1 };
            },
          },
        },
      },
      { appConfig, resolvePageUse: async () => [] }
    )
  );
  return app;
}

function postLoader(app: Hono, loader = 'default') {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'pages/movies', loader, location: loc }),
  });
}

function buildActionHandler(appConfig: AppConfig) {
  const resolverByPath = async () =>
    new Map([
      [
        'submit',
        {
          fn: async () => ({ ok: true }),
          use: [publishingGate()],
          moduleKey: 'pages/test.server',
          input: undefined,
          routeId: undefined,
        },
      ],
    ]);
  const renderPage = vi.fn(
    async (c: { html: (s: string) => unknown }) =>
      c.html('<!doctype html><body>RENDERED</body>')
  );
  return pageActionsHandler({
    resolverByPath,
    resolvePageUseByPattern: async () => [],
    renderPage: renderPage as never,
    resolvePageNode: () => h('div', null),
    appConfig,
  });
}

function postAction(handler: ReturnType<typeof pageActionsHandler>) {
  const app = new Hono().post('*', handler);
  return app.request('/foo', {
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
}

describe('RPC channel header', () => {
  it('sets the header on the loader JSON response when a chain published', async () => {
    const app = makeLoadersApp({ use: [publishingGate()] });
    const res = await postLoader(app);
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });

  it('sets the header on the SSE response too', async () => {
    const app = makeLoadersApp({ use: [publishingGate()] });
    const res = await postLoader(app, 'stream');
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });

  it('omits the header when nothing published', async () => {
    const app = makeLoadersApp({ use: [] });
    const res = await postLoader(app);
    expect(res.headers.get(CHANNEL_HEADER)).toBeNull();
  });

  it('sets the header on an action response', async () => {
    const handler = buildActionHandler({ use: [] });
    const res = await postAction(handler);
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });
});
