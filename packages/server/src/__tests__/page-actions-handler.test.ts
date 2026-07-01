import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { Hono } from 'hono';
import { pageActionsHandler } from '../page-actions-handler.js';
import {
  deny,
  redirect,
  defineAction,
  isTimeout,
  defineServerMiddleware,
} from '@hono-preact/iso';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { VALIDATION_ISSUES_KEY } from '@hono-preact/iso/internal/runtime';

const failing: StandardSchemaV1<unknown, unknown> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ issues: [{ message: 'Required', path: ['title'] }] }),
  },
};
const coercing: StandardSchemaV1<unknown, { count: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => ({
      value: { count: Number((v as { count: unknown }).count) },
    }),
  },
};

type PageUseResolver = (
  path: string
) => ReadonlyArray<unknown> | Promise<ReadonlyArray<unknown>>;

function buildHandler(
  actions: Record<
    string,
    | ((ctx: unknown, payload: unknown) => Promise<unknown>)
    | {
        fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
        input?: import('@standard-schema/spec').StandardSchemaV1;
        use?: ReadonlyArray<unknown>;
        routeId?: string;
      }
  >,
  pageUse?: { byPath?: PageUseResolver; byPattern?: PageUseResolver }
) {
  const resolverByPath = async () => {
    const map = new Map();
    for (const [name, val] of Object.entries(actions)) {
      const entry = typeof val === 'function' ? { fn: val } : val;
      map.set(name, {
        fn: entry.fn,
        use: 'use' in entry ? (entry.use ?? []) : [],
        moduleKey: 'pages/test.server',
        input: 'input' in entry ? entry.input : undefined,
        routeId: 'routeId' in entry ? entry.routeId : undefined,
      });
    }
    return map;
  };
  const renderPage = vi.fn(
    async (c: { html: (s: string) => unknown }, _node: unknown) =>
      c.html('<!doctype html><body>RENDERED</body>')
  );
  return pageActionsHandler({
    resolverByPath,
    // No page-level middleware in the default fixture; the byPattern/byPath
    // branch tests below inject resolvers to observe which path is taken.
    resolvePageUseByPath: pageUse?.byPath ?? (async () => []),
    resolvePageUseByPattern: pageUse?.byPattern ?? (async () => []),
    renderPage: renderPage as never,
    resolvePageNode: () => h('div', null),
    appConfig: { use: [] },
  });
}

describe('pageActionsHandler', () => {
  it('returns __outcome=success JSON envelope on Accept: application/json', async () => {
    const handler = buildHandler({
      submit: async () => ({ id: 42 }),
    });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'submit',
        payload: { x: 1 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ __outcome: 'success', data: { id: 42 } });
  });

  // A page-use middleware that denies with a distinct status, so the response
  // status reveals WHICH resolver (byPattern vs byPath) supplied the chain.
  const denyGuard = (status: 401 | 403 | 418, message: string) =>
    defineServerMiddleware<'action'>(async () => {
      throw deny(status, message);
    });

  it('route-bound action resolves page-use by its pattern, not the request URL', async () => {
    const byPath = vi.fn(async () => [denyGuard(418, 'via-path')]);
    const byPattern = vi.fn(async () => [denyGuard(403, 'via-pattern')]);
    const handler = buildHandler(
      { submit: { fn: async () => ({ ok: true }), routeId: '/foo/:id' } },
      { byPath, byPattern }
    );
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo/42', {
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
    // The byPattern guard for '/foo/:id' fired (403); the byPath guard for the
    // concrete URL '/foo/42' (418) was NOT consulted.
    expect(res.status).toBe(403);
    expect(byPattern).toHaveBeenCalledWith('/foo/:id');
    expect(byPath).not.toHaveBeenCalled();
  });

  it('bare (route-independent) action resolves page-use by the request URL', async () => {
    const byPath = vi.fn(async () => [denyGuard(418, 'via-path')]);
    const byPattern = vi.fn(async () => [denyGuard(403, 'via-pattern')]);
    const handler = buildHandler(
      { submit: async () => ({ ok: true }) }, // no routeId -> not route-bound
      { byPath, byPattern }
    );
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo/42', {
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
    // The byPath guard for the concrete URL fired (418); byPattern untouched.
    expect(res.status).toBe(418);
    expect(byPath).toHaveBeenCalledWith('/foo/42');
    expect(byPattern).not.toHaveBeenCalled();
  });

  it('fails closed (500) when a route-bound action cannot resolve its pattern chain', async () => {
    const byPattern = vi.fn(async () => {
      throw new Error('resolver boom');
    });
    const onError = vi.fn();
    // Built inline (not via buildHandler) so we can wire onError and assert the
    // fail-closed side channel fires.
    const wrapped = pageActionsHandler({
      resolverByPath: async () =>
        new Map([
          [
            'submit',
            {
              fn: async () => ({ ok: true }),
              use: [],
              moduleKey: 'pages/test.server',
              routeId: '/foo/:id',
            },
          ],
        ]) as never,
      resolvePageUseByPath: async () => [],
      resolvePageUseByPattern: byPattern,
      renderPage: (async () => new Response('x')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
      onError,
    });
    const app = new Hono().post('*', wrapped);
    const res = await app.request('/foo/42', {
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
    // Guard resolution threw: the action must NOT run guard-less; 500 + onError.
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalled();
  });

  it('returns real 303 on Accept: text/html when action returns data', async () => {
    const handler = buildHandler({ submit: async () => ({ id: 42 }) });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----b',
        Accept: 'text/html',
      },
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
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----b',
        Accept: 'text/html',
      },
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
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----b',
        Accept: 'text/html',
      },
      body: '------b\r\nContent-Disposition: form-data; name="__module"\r\n\r\npages/test.server\r\n------b\r\nContent-Disposition: form-data; name="__action"\r\n\r\nsubmit\r\n------b--\r\n',
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('RENDERED');
  });

  it('returns 405 text when streaming action invoked with Accept: text/html', async () => {
    async function* gen() {
      yield { tick: 1 };
    }
    const handler = buildHandler({ stream: async () => gen() });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'stream',
        payload: {},
      }),
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain(
      'Streaming actions require Accept: text/event-stream'
    );
  });

  it('returns 405 JSON envelope when streaming action invoked with Accept: application/json', async () => {
    async function* gen() {
      yield { tick: 1 };
    }
    const handler = buildHandler({ stream: async () => gen() });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'stream',
        payload: {},
      }),
    });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toEqual({
      __outcome: 'error',
      message: 'Streaming actions require Accept: text/event-stream',
    });
  });

  it('returns 404 when the action is not declared on the page chain', async () => {
    const handler = buildHandler({ submit: async () => 'ok' });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'missing',
        payload: {},
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns deny(422) JSON envelope with issues when input schema fails', async () => {
    const fn = vi.fn(async () => ({ id: 1 }));
    const handler = buildHandler({ submit: { fn, input: failing } });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
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
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.__outcome).toBe('deny');
    expect(body.data[VALIDATION_ISSUES_KEY]).toEqual([
      { path: ['title'], message: 'Required' },
    ]);
    expect(fn).not.toHaveBeenCalled(); // handler never ran
  });

  it('passes the coerced output to the handler when the schema passes', async () => {
    let seen: unknown;
    const fn = vi.fn(async (_ctx: unknown, payload: unknown) => {
      seen = payload;
      return 'ok';
    });
    const handler = buildHandler({ submit: { fn, input: coercing } });
    const app = new Hono().post('*', handler);
    const res = await app.request('/foo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/test.server',
        action: 'submit',
        payload: { count: '3' },
      }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ count: 3 }); // coercion observable to the handler
  });
});

// Helper that wires a single defineAction fn through pageActionsHandler with
// timeout options, exercising per-action and handler-default timeout paths.
function buildTimedApp(
  actionFn: Parameters<typeof defineAction>[0],
  opts: {
    perActionTimeoutMs?: number | false;
    defaultTimeoutMs?: number | false;
  }
) {
  const action = defineAction(
    actionFn,
    opts.perActionTimeoutMs !== undefined
      ? { timeoutMs: opts.perActionTimeoutMs }
      : undefined
  );
  const resolverByPath = async () => {
    const map = new Map();
    const metadata = action as unknown as {
      use?: ReadonlyArray<unknown>;
      timeoutMs?: number | false;
    };
    map.set('create', {
      fn: action as (ctx: unknown, payload: unknown) => Promise<unknown>,
      use: metadata.use ?? [],
      timeoutMs: metadata.timeoutMs,
      moduleKey: 'pages/timed',
    });
    return map;
  };
  const noopRender = async () => new Response('', { status: 200 });
  const handler = pageActionsHandler({
    resolverByPath,
    resolvePageUseByPath: async () => [], // no page-level middleware in this fixture
    resolvePageUseByPattern: async () => [],
    renderPage: noopRender as never,
    resolvePageNode: () => null,
    ...(opts.defaultTimeoutMs !== undefined
      ? { defaultTimeoutMs: opts.defaultTimeoutMs }
      : {}),
  });
  const app = new Hono().post('*', handler);
  const post = (body: unknown) =>
    app.request('http://localhost/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  return { app, post };
}

describe('pageActionsHandler timeouts', () => {
  it('returns a timeout outcome when the action exceeds its timeoutMs', async () => {
    const { post } = buildTimedApp(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return { id: 1 };
      },
      { perActionTimeoutMs: 50 }
    );

    const res = await post({
      module: 'pages/timed',
      action: 'create',
      payload: {},
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as unknown;
    expect(isTimeout(body)).toBe(true);
    expect((body as { timeoutMs: number }).timeoutMs).toBe(50);
  });

  it('uses the handler default when the action has no timeoutMs', async () => {
    const { post } = buildTimedApp(
      async ({ signal }) => {
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        return { ok: true };
      },
      { defaultTimeoutMs: 50 }
    );

    const res = await post({
      module: 'pages/timed',
      action: 'create',
      payload: {},
    });
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

    const res = await post({
      module: 'pages/timed',
      action: 'create',
      payload: {},
    });
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
