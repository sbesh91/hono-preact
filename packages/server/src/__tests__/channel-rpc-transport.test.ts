import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { h } from 'preact';
import { defineServerMiddleware, deny, type AppConfig } from '@hono-preact/iso';
import {
  publishToChannel,
  takeChannelSnapshot,
  CHANNEL_HEADER,
} from '@hono-preact/iso/internal';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionsHandler } from '../page-actions-handler.js';

const loc = { path: '/movies', pathParams: {}, searchParams: {} };

function publishingGate() {
  return defineServerMiddleware(async (_ctx, next) => {
    publishToChannel('demo', { signedIn: true });
    await next();
  });
}

/** Publishes, then denies: the guard clears a session hint on the way out. */
function publishThenDenyGate() {
  return defineServerMiddleware(async () => {
    publishToChannel('demo', { signedIn: false });
    throw deny(401, 'expired');
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
  const renderPage = vi.fn(async (c: { html: (s: string) => unknown }) =>
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

  it('sets the header on a loader response denied after publishing', async () => {
    const app = makeLoadersApp({ use: [publishThenDenyGate()] });
    const res = await postLoader(app);
    expect(res.status).toBe(401);
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":false}}');
  });
});

/**
 * The progressive-enhancement paths: a no-JS form post (no `Accept:
 * application/json`) and a streaming action a client cannot accept SSE for.
 * Both leave the action chain's snapshot on the floor unless the handler
 * carries it, and the re-render additionally needs it seeded into its own
 * request scope so the document's bootstrap is not empty.
 */
function buildPeHandler(opts: {
  fn: () => Promise<unknown>;
  onRenderSnapshot?: (snapshot: unknown) => void;
}) {
  const resolverByPath = async () =>
    new Map([
      [
        'submit',
        {
          fn: opts.fn,
          use: [publishingGate()],
          moduleKey: 'pages/test.server',
          input: undefined,
          routeId: undefined,
        },
      ],
    ]);
  const renderPage = vi.fn(async (c: { html: (s: string) => unknown }) => {
    // Runs inside the re-render's own request scope, which is where
    // `renderPage` reads the snapshot it inlines into the document.
    opts.onRenderSnapshot?.(takeChannelSnapshot());
    return c.html('<!doctype html><body>RENDERED</body>');
  });
  return pageActionsHandler({
    resolverByPath,
    resolvePageUseByPattern: async () => [],
    renderPage: renderPage as never,
    resolvePageNode: () => h('div', null),
    appConfig: { use: [] },
  });
}

function postForm(
  handler: ReturnType<typeof pageActionsHandler>,
  accept = 'text/html'
) {
  const app = new Hono().post('*', handler);
  const body = new FormData();
  body.set('__action', 'submit');
  body.set('__module', 'pages/test.server');
  return app.request('/foo', {
    method: 'POST',
    headers: { Accept: accept },
    body,
  });
}

describe('PE channel header', () => {
  it('carries the snapshot into the deny re-render and onto its response', async () => {
    let seen: unknown = 'not-called';
    const handler = buildPeHandler({
      fn: async () => {
        throw deny(403, 'nope');
      },
      onRenderSnapshot: (snapshot) => {
        seen = snapshot;
      },
    });
    const res = await postForm(handler);

    expect(res.status).toBe(403);
    expect(seen).toEqual({ demo: { signedIn: true } });
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });

  it('sets the header on the streaming 405 a non-SSE client gets', async () => {
    const handler = buildPeHandler({
      // An action "returns" a stream by handing back an async generator, which
      // the handler awaits like any other action result.
      fn: async () =>
        (async function* () {
          yield { tick: 1 };
        })(),
    });
    const res = await postForm(handler);

    expect(res.status).toBe(405);
    expect(res.headers.get(CHANNEL_HEADER)).toBe('{"demo":{"signedIn":true}}');
  });
});
