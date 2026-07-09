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
  pageUse?: { byPattern?: PageUseResolver },
  extra?: {
    dev?: boolean;
    onError?: (
      err: unknown,
      ctx: { module: string; action: string; routeId?: string }
    ) => void;
  }
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
    // No page-level middleware in the default fixture. Bare actions get no page
    // tier at all; the byPattern branch tests below inject a resolver to observe
    // the route-bound path.
    resolvePageUseByPattern: pageUse?.byPattern ?? (async () => []),
    renderPage: renderPage as never,
    resolvePageNode: () => h('div', null),
    appConfig: { use: [] },
    ...extra,
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

  // A src/server registry action is not in any route's byPath map; it resolves
  // through the moduleKey fallback the handler tries when byPath misses. A bare
  // registry action (no routeId) is route-independent, so it gets no page tier.
  const registryHandler = (actionUse: ReadonlyArray<unknown> = []) => {
    const entry = {
      fn: async () => ({ ran: 'registry' }),
      use: actionUse,
      moduleKey: 'src/server/reports.server',
      routeId: undefined as string | undefined,
    };
    return pageActionsHandler({
      resolverByPath: async () => new Map(), // no route action map
      resolverByModuleKey: async (moduleKey, name) =>
        moduleKey === entry.moduleKey && name === 'export' ? entry : undefined,
      resolvePageUseByPattern: async () => [],
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('x')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
  };

  const postRegistry = (handler: ReturnType<typeof pageActionsHandler>) =>
    new Hono().post('*', handler).request('/some/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'src/server/reports.server',
        action: 'export',
        payload: {},
      }),
    });

  it('dispatches a route-less src/server action via the byModuleKey fallback', async () => {
    const res = await postRegistry(registryHandler());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      __outcome: 'success',
      data: { ran: 'registry' },
    });
  });

  it('does NOT gate a route-less registry action by the invoking page', async () => {
    // A bare (route-independent) registry action gets no page tier, so the
    // invoking page's guards never run against it. This is the whole point of
    // route-independence: the client picks the POST URL, so the page it posts
    // from must not be a security boundary. Guard such an action at the unit
    // level instead (next test).
    const res = await postRegistry(registryHandler());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      __outcome: 'success',
      data: { ran: 'registry' },
    });
  });

  it('gates a route-less registry action by its own unit-level use', async () => {
    // The supported way to protect a bare action: an action-level `use` is
    // always composed, regardless of the POST URL.
    const res = await postRegistry(
      registryHandler([denyGuard(401, 'unit-gate')])
    );
    expect(res.status).toBe(401);
  });

  it('does not let the moduleKey fallback reach a route-attached action', async () => {
    // byPath has the action for its route, but the client posts from a URL
    // whose route map misses it; a registry-only byModuleKey must NOT rescue
    // it (that would bypass the route's gates). Here byModuleKey returns
    // undefined for the route module, so the miss is a 404.
    const handler = pageActionsHandler({
      resolverByPath: async () => new Map(), // wrong URL: no match
      resolverByModuleKey: async () => undefined, // route actions are not indexed
      resolvePageUseByPattern: async () => [],
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('x')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
    const res = await new Hono().post('*', handler).request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'pages/gated.server',
        action: 'deleteProject',
        payload: {},
      }),
    });
    expect(res.status).toBe(404);
  });

  it('gates a route-bound registry action by its pattern, not the request URL', async () => {
    // A serverRoute()-bound registry action (routeId set) resolves via the
    // moduleKey fallback but must gate on byPattern(routeId), independent of the
    // page it was invoked from.
    const entry = {
      fn: async () => ({ ok: true }),
      use: [] as ReadonlyArray<unknown>,
      moduleKey: 'src/server/reports.server',
      routeId: '/reports/:id',
    };
    const byPattern = vi.fn(async () => [denyGuard(403, 'via-pattern')]);
    const handler = pageActionsHandler({
      resolverByPath: async () => new Map(),
      resolverByModuleKey: async () => entry,
      resolvePageUseByPattern: byPattern,
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('x')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
    const res = await new Hono().post('*', handler).request('/anywhere', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        module: 'src/server/reports.server',
        action: 'archive',
        payload: {},
      }),
    });
    expect(res.status).toBe(403); // pattern guard fired
    expect(byPattern).toHaveBeenCalledWith('/reports/:id');
  });

  it('404s a moduleKey miss (no registry entry)', async () => {
    const handler = pageActionsHandler({
      resolverByPath: async () => new Map(),
      resolverByModuleKey: async () => undefined,
      resolvePageUseByPattern: async () => [],
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('x')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
    const res = await postRegistry(handler);
    expect(res.status).toBe(404);
  });

  // A page-use middleware that denies with a distinct status, so the response
  // status reveals WHICH resolver (byPattern vs byPath) supplied the chain.
  const denyGuard = (status: 401 | 403 | 418, message: string) =>
    defineServerMiddleware<'action'>(async () => {
      throw deny(status, message);
    });

  it('route-bound action resolves page-use by its pattern, not the request URL', async () => {
    const byPattern = vi.fn(async () => [denyGuard(403, 'via-pattern')]);
    const handler = buildHandler(
      { submit: { fn: async () => ({ ok: true }), routeId: '/foo/:id' } },
      { byPattern }
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
    // The byPattern guard for the DECLARED pattern '/foo/:id' fired (403), not
    // the concrete request URL '/foo/42'.
    expect(res.status).toBe(403);
    expect(byPattern).toHaveBeenCalledWith('/foo/:id');
  });

  it('bare (route-independent) action gets NO page tier (sibling-route bypass is impossible)', async () => {
    // Security regression: a bare action must not resolve any page-use chain
    // from the request URL. Previously the handler fuzzy-matched the POST URL,
    // so an attacker could POST a guarded action to a weaker sibling route to
    // pick up that route's (empty) guards. Now a bare action never consults a
    // page-use resolver: byPattern is not called, and the injected guard (which
    // would deny 403 if it ran) never fires. The action runs to success.
    const byPattern = vi.fn(async () => [denyGuard(403, 'via-pattern')]);
    const handler = buildHandler(
      { submit: async () => ({ ok: true }) }, // no routeId -> not route-bound
      { byPattern }
    );
    const app = new Hono().post('*', handler);
    // POST to a route that is NOT where the action is declared; under the old
    // fuzzy behavior this is exactly the attacker's lever.
    const res = await app.request('/orgs/new', {
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
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      __outcome: 'success',
      data: { ok: true },
    });
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

  it('gates the streaming action error frame on dev', async () => {
    const make = (dev: boolean) =>
      pageActionsHandler({
        resolverByPath: async () =>
          new Map([
            [
              'stream',
              {
                fn: async () =>
                  (async function* () {
                    yield { tick: 1 };
                    throw new Error('secret detail');
                  })(),
                use: [],
                moduleKey: 'pages/test.server',
              },
            ],
          ]) as never,
        resolvePageUseByPattern: async () => [],
        renderPage: (async () => new Response('x')) as never,
        resolvePageNode: () => h('div', null),
        appConfig: { use: [] },
        dev,
      });
    const post = (handler: ReturnType<typeof pageActionsHandler>) =>
      new Hono().post('*', handler).request('/foo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          module: 'pages/test.server',
          action: 'stream',
          payload: {},
        }),
      });
    const prodBody = await (await post(make(false))).text();
    expect(prodBody).toContain('"message":"Stream failed"');
    expect(prodBody).not.toContain('secret detail');
    const devBody = await (await post(make(true))).text();
    expect(devBody).toContain('"message":"secret detail"');
  });

  describe('error masking and the dev deny() hint', () => {
    const postSubmit = (handler: ReturnType<typeof pageActionsHandler>) =>
      new Hono().post('*', handler).request('/foo', {
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

    it('masks a thrown non-outcome error as Action failed by default (production)', async () => {
      const handler = buildHandler({
        submit: async () => {
          throw new Error('DB error: connection refused at 10.0.0.5');
        },
      });
      const res = await postSubmit(handler);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ __outcome: 'error', message: 'Action failed' });
    });

    it('passes the thrown error message through when dev: true', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          {
            submit: async () => {
              throw new Error('DB error: hostname leaked');
            },
          },
          undefined,
          { dev: true }
        );
        const res = await postSubmit(handler);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body).toEqual({
          __outcome: 'error',
          message: 'DB error: hostname leaked',
        });
      } finally {
        warn.mockRestore();
      }
    });

    it('hints at deny(status, message) on the console when dev: true', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          {
            submit: async () => {
              throw new Error('email is required');
            },
          },
          undefined,
          { dev: true }
        );
        await postSubmit(handler);
        const hints = warn.mock.calls.filter((call) =>
          String(call[0]).includes('deny(status, message)')
        );
        expect(hints).toHaveLength(1);
        expect(String(hints[0]![0])).toContain('pages/test.server::submit');
        expect(String(hints[0]![0])).toContain('email is required');
      } finally {
        warn.mockRestore();
      }
    });

    it('does not hint on the console in production (dev omitted)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler({
          submit: async () => {
            throw new Error('boom');
          },
        });
        await postSubmit(handler);
        const hints = warn.mock.calls.filter((call) =>
          String(call[0]).includes('deny(status, message)')
        );
        expect(hints).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('includes the resolver error detail in the fail-closed message only when dev: true', async () => {
      const byPattern = async () => {
        throw new Error('resolver boom: internal path /srv/gates.ts');
      };
      const routeBound = {
        submit: {
          fn: async () => ({ ok: true }),
          routeId: '/foo/:id',
        },
      };
      const prodRes = await postSubmit(buildHandler(routeBound, { byPattern }));
      expect(prodRes.status).toBe(500);
      const prodBody = await prodRes.json();
      expect(prodBody.message).toBe(
        "Route-bound action '/foo/:id' could not resolve its page-use chain"
      );
      const devRes = await postSubmit(
        buildHandler(routeBound, { byPattern }, { dev: true })
      );
      const devBody = await devRes.json();
      expect(devBody.message).toContain(
        'resolver boom: internal path /srv/gates.ts'
      );
    });
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
    resolvePageUseByPattern: async () => [], // no page-level middleware in this fixture
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
