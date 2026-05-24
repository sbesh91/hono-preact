import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
  defineStreamObserver,
} from '@hono-preact/iso';
import { loadersHandler } from '../loaders-handler.js';
import { pageActionHandler } from '../page-action-handler.js';
import { makePageActionResolvers } from '../page-action-resolvers.js';
import { makePageUseResolvers } from '../route-server-modules.js';

describe('loaders-handler dispatches the full chain (root -> page -> unit)', () => {
  it('runs middleware in outer->inner order with appConfig + resolvePageUse + per-unit use', async () => {
    const calls: string[] = [];

    const root = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('root:before');
      await next();
      calls.push('root:after');
    });
    const page = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    const unit = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('unit:before');
      await next();
      calls.push('unit:after');
    });

    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [unit] }
    );

    const serverModules: Record<string, unknown> = {
      'test/m': {
        __moduleKey: 'test/m',
        serverLoaders: { l: loader },
      },
    };

    const appConfig = defineApp({ use: [root] });

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        appConfig,
        resolvePageUse: () => [page],
      })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe('ok');
    expect(calls).toEqual([
      'root:before',
      'page:before',
      'unit:before',
      'inner',
      'unit:after',
      'page:after',
      'root:after',
    ]);
  });

  it('makePageUseResolvers feeds pageUse into the chain by location path', async () => {
    const calls: string[] = [];
    const page = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });

    const loader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'pages/p1', __loaderName: 'l' }
    );

    const serverModules: Record<string, unknown> = {
      'pages/p1.server.ts': {
        __moduleKey: 'pages/p1',
        pageUse: [page],
        serverLoaders: { l: loader },
      },
    };

    // The resolver pulls page-use from the same lazy modules the handler
    // consumes; here we declare a single route `/p1` whose server module is
    // the same record above. The handler awaits resolvePageUse so the lazy
    // build runs transparently on first request.
    const { byPath } = makePageUseResolvers([
      {
        path: '/p1',
        server: async () =>
          (serverModules as Record<string, unknown>)['pages/p1.server.ts'],
        ancestors: [],
      },
    ]);

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, {
        dev: true,
        resolvePageUse: byPath,
      })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/p1',
        loader: 'l',
        location: { path: '/p1', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(['page:before', 'inner', 'page:after']);
  });

  it('makePageUseResolvers feeds pageUse into actions by module key', async () => {
    // Smoke-only: action-handler wiring is the symmetric path; we already
    // assert the loader-handler outer->inner chain above. This case proves
    // the byModuleKey lookup table is populated.
    const { byModuleKey } = makePageUseResolvers([
      {
        path: '/p2',
        server: async () => ({
          __moduleKey: 'pages/p2',
          pageUse: ['marker'],
        }),
        ancestors: [],
      },
    ]);
    await expect(byModuleKey('pages/p2')).resolves.toEqual(['marker']);
    await expect(byModuleKey('nope')).resolves.toEqual([]);
  });

  it('matches parameterized leaf URLs against pattern paths', async () => {
    // Routes are declared with patterns (`/admin/users/:id`) but the
    // request carries the concrete URL the user navigated to
    // (`/admin/users/42`). The resolver must match pattern segments
    // against URL segments rather than relying on exact-string equality,
    // or per-page gating silently no-ops on every parameterized route.
    const { byPath } = makePageUseResolvers([
      {
        path: '/admin/users/:id',
        server: async () => ({
          __moduleKey: 'admin/users',
          pageUse: ['user-gate'],
        }),
        ancestors: [],
      },
    ]);
    await expect(byPath('/admin/users/42')).resolves.toEqual(['user-gate']);
    await expect(byPath('/admin/users/abc/extra')).resolves.toEqual([]);
    await expect(byPath('/admin/users')).resolves.toEqual([]);
  });

  it('composes pageUse from layout ancestors down to the matched leaf', async () => {
    // Route tree:
    //   /admin          (layout .server.ts, pageUse = [adminGate])
    //   /admin/users/:id (leaf .server.ts,   pageUse = [auditLog])
    // The leaf declares `/admin`'s server thunk as its ancestor (route
    // tree edge); a request to the leaf must run [adminGate, auditLog].
    const calls: string[] = [];
    const adminGate = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('admin:before');
      await next();
      calls.push('admin:after');
    });
    const auditLog = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('audit:before');
      await next();
      calls.push('audit:after');
    });

    const leafLoader = defineLoader<string>(
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'admin/users', __loaderName: 'list' }
    );

    const adminServer = { __moduleKey: 'admin', pageUse: [adminGate] };
    const leafServer = {
      __moduleKey: 'admin/users',
      pageUse: [auditLog],
      serverLoaders: { list: leafLoader },
    };
    const serverModules: Record<string, unknown> = {
      'admin/layout.server.ts': adminServer,
      'admin/users/[id].server.ts': leafServer,
    };

    const adminThunk = async () => adminServer;
    const { byPath } = makePageUseResolvers([
      { path: '/admin', server: adminThunk, ancestors: [] },
      {
        path: '/admin/users/:id',
        server: async () => leafServer,
        ancestors: [adminThunk],
      },
    ]);

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true, resolvePageUse: byPath })
    );

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'admin/users',
        loader: 'list',
        location: {
          path: '/admin/users/42',
          pathParams: { id: '42' },
          searchParams: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'admin:before',
      'audit:before',
      'inner',
      'audit:after',
      'admin:after',
    ]);
  });

  it('byModuleKey returns the same composed array as byPath would', async () => {
    // Action handler routes by module key (which is unambiguous per
    // .server.* file). The result must include ancestor pageUse the same
    // way the loader path does, so an action call can never sneak past a
    // gate the URL path would have triggered.
    const adminServer = { __moduleKey: 'admin', pageUse: ['admin-gate'] };
    const leafServer = { __moduleKey: 'admin/users', pageUse: ['audit'] };
    const adminThunk = async () => adminServer;
    const { byPath, byModuleKey } = makePageUseResolvers([
      { path: '/admin', server: adminThunk, ancestors: [] },
      {
        path: '/admin/users/:id',
        server: async () => leafServer,
        ancestors: [adminThunk],
      },
    ]);
    await expect(byPath('/admin/users/42')).resolves.toEqual([
      'admin-gate',
      'audit',
    ]);
    await expect(byModuleKey('admin/users')).resolves.toEqual([
      'admin-gate',
      'audit',
    ]);
    // The layout's own module also composes (it has no ancestors with
    // pageUse here, so just its own).
    await expect(byModuleKey('admin')).resolves.toEqual(['admin-gate']);
  });
});

describe('makePageUseResolvers — literal-vs-param tiebreaker (E1)', () => {
  it('prefers a literal route over a parameterized sibling at the same depth', async () => {
    // Two routes registered at the same depth: a literal `/admin/users/me`
    // and a param `/admin/users/:id`. preact-iso prefers the literal at
    // runtime, so the server-side gate lookup must match that choice or the
    // page render and the gate fire mismatch.
    const meServer = { __moduleKey: 'admin/me', pageUse: ['me-gate'] };
    const idServer = { __moduleKey: 'admin/id', pageUse: ['id-gate'] };
    const { byPath } = makePageUseResolvers([
      {
        path: '/admin/users/:id',
        server: async () => idServer,
        ancestors: [],
      },
      {
        path: '/admin/users/me',
        server: async () => meServer,
        ancestors: [],
      },
    ]);
    await expect(byPath('/admin/users/me')).resolves.toEqual(['me-gate']);
    // Sanity: a different id still routes to the parameterized entry.
    await expect(byPath('/admin/users/42')).resolves.toEqual(['id-gate']);
  });

  it('within the same score, the deeper pattern wins', async () => {
    // Both `/a` and `/a/b` match `/a/b` against urlPathMatchesPattern? No --
    // pattern length must match URL length. Use a case where two patterns
    // share the same score: one with two literal segments and one with one
    // literal+wildcard would mismatch differently. Easiest: two siblings
    // with same score but different depths, asserted via a wildcard.
    const shallow = { __moduleKey: 'shallow', pageUse: ['s'] };
    const deep = { __moduleKey: 'deep', pageUse: ['d'] };
    const { byPath } = makePageUseResolvers([
      // Wildcard at index 0 -> score 0 -> caller-order tiebreaker against
      // any other matching wildcard pattern; depth picks the deeper one.
      { path: '/*', server: async () => shallow, ancestors: [] },
      { path: '/x/*', server: async () => deep, ancestors: [] },
    ]);
    await expect(byPath('/x/y')).resolves.toEqual(['d']);
  });
});

describe('makePageUseResolvers — route-tree ancestor composition (E2)', () => {
  it('does NOT compose siblings that merely share a URL prefix', async () => {
    // Tree:
    //   /demo/projects                                  (server, gate=A)
    //   /demo/projects/:projectId/issues/:issueId       (server, gate=B)
    // These are SIBLINGS in the route tree (no shared layout server).
    // URL-prefix matching would incorrectly conflate them and run A on
    // every request to /issues/:issueId. The route-tree walker emits
    // ancestors EXPLICITLY -- siblings get no ancestors -- so the wrong
    // composition can't happen.
    const projectsServer = { __moduleKey: 'projects', pageUse: ['A'] };
    const issueServer = { __moduleKey: 'issue', pageUse: ['B'] };
    const { byPath } = makePageUseResolvers([
      {
        path: '/demo/projects',
        server: async () => projectsServer,
        ancestors: [],
      },
      {
        path: '/demo/projects/:projectId/issues/:issueId',
        server: async () => issueServer,
        // Real route tree: layout `/demo/projects/:projectId` has no
        // server, so issue has no ancestors with pageUse.
        ancestors: [],
      },
    ]);
    await expect(byPath('/demo/projects/abc/issues/123')).resolves.toEqual([
      'B',
    ]);
    await expect(byPath('/demo/projects')).resolves.toEqual(['A']);
  });

  it('composes pageUse of real layout ancestors (parent-of-leaf via ancestors)', async () => {
    // Edge case partner to the test above. Suppose a layout group `/admin`
    // DOES have a server module with pageUse, and a leaf `/admin/users/:id`
    // is its descendant. The leaf gets the layout's ancestor thunk in its
    // `ancestors` array; composition follows.
    const layoutServer = { __moduleKey: 'admin', pageUse: ['layoutGate'] };
    const editServer = {
      __moduleKey: 'admin/users/edit',
      pageUse: ['leafGate'],
    };
    const layoutThunk = async () => layoutServer;
    const { byPath } = makePageUseResolvers([
      { path: '/admin', server: layoutThunk, ancestors: [] },
      {
        path: '/admin/users/:userId/edit',
        server: async () => editServer,
        ancestors: [layoutThunk],
      },
    ]);
    await expect(byPath('/admin/users/42/edit')).resolves.toEqual([
      'layoutGate',
      'leafGate',
    ]);
  });
});

describe('makePageUseResolvers — resolver lifecycle', () => {
  it('does not poison the cache on a failed build (retry succeeds)', async () => {
    // The docstring promises: a failed build does not permanently poison
    // the resolver. The next call retries from scratch.
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return { __moduleKey: 'k', pageUse: ['ok'] };
    };
    const { byPath } = makePageUseResolvers([
      { path: '/p', server: flaky, ancestors: [] },
    ]);
    await expect(byPath('/p')).rejects.toThrow('transient');
    // Second call rebuilds and succeeds.
    await expect(byPath('/p')).resolves.toEqual(['ok']);
  });

  it('returns empty arrays for empty serverRoutes', async () => {
    const { byPath, byModuleKey } = makePageUseResolvers([]);
    await expect(byPath('/anything')).resolves.toEqual([]);
    await expect(byModuleKey('any')).resolves.toEqual([]);
  });

  it("returns the layout's own pageUse when queried by its own pattern", async () => {
    const layoutServer = { __moduleKey: 'admin', pageUse: ['gate'] };
    const { byPath } = makePageUseResolvers([
      { path: '/admin', server: async () => layoutServer, ancestors: [] },
    ]);
    await expect(byPath('/admin')).resolves.toEqual(['gate']);
  });

  it('rebuilds on every call when dev: true', async () => {
    // The dev rebuild plumbing is the cache-bypass: each call to byPath
    // / byModuleKey re-loads the underlying server thunks. Edits to a
    // .server.ts file's pageUse must take effect without a restart.
    let loads = 0;
    const thunk = async () => {
      loads += 1;
      return { __moduleKey: 'k', pageUse: [`v${loads}`] };
    };
    const { byPath } = makePageUseResolvers(
      [{ path: '/p', server: thunk, ancestors: [] }],
      { dev: true }
    );
    await expect(byPath('/p')).resolves.toEqual(['v1']);
    await expect(byPath('/p')).resolves.toEqual(['v2']);
    expect(loads).toBe(2);
  });

  it('caches across calls when dev is false (default)', async () => {
    let loads = 0;
    const thunk = async () => {
      loads += 1;
      return { __moduleKey: 'k', pageUse: ['static'] };
    };
    const { byPath } = makePageUseResolvers([
      { path: '/p', server: thunk, ancestors: [] },
    ]);
    await expect(byPath('/p')).resolves.toEqual(['static']);
    await expect(byPath('/p')).resolves.toEqual(['static']);
    expect(loads).toBe(1);
  });

  it('throws a descriptive runtime error when pageUse is not an array (E5)', async () => {
    // The Vite validation plugin (Agent F's F3) catches this at build time;
    // this is the runtime backstop for users who bypass the plugin
    // (programmatic glob, manual wiring).
    const badServer = {
      __moduleKey: 'k',
      // Common typo: forgetting to wrap a single middleware in brackets.
      pageUse: { __kind: 'middleware', runs: 'server', fn: async () => {} },
    };
    const { byPath } = makePageUseResolvers([
      { path: '/p', server: async () => badServer, ancestors: [] },
    ]);
    await expect(byPath('/p')).rejects.toThrow(/non-array `pageUse`/);
  });

  it('treats missing pageUse as empty (the common case)', async () => {
    const { byPath } = makePageUseResolvers([
      {
        path: '/p',
        server: async () => ({ __moduleKey: 'p' }),
        ancestors: [],
      },
    ]);
    await expect(byPath('/p')).resolves.toEqual([]);
  });
});

describe('stream observer fanout (E20)', () => {
  it('fires onStart, onChunk per yield, and onEnd on a streaming loader through loadersHandler', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, void>({
      onStart: () => events.push('start'),
      onChunk: (_ctx, chunk, i) => events.push(`chunk:${i}:${chunk}`),
      onEnd: (_ctx, info) => events.push(`end:${info.chunks}`),
      onError: () => events.push('error'),
      onAbort: () => events.push('abort'),
    });

    const streamLoader = defineLoader<number>(
      async function* () {
        yield 10;
        yield 20;
        yield 30;
      },
      { __moduleKey: 'mod', __loaderName: 's', use: [observer] }
    );

    const serverModules: Record<string, unknown> = {
      mod: {
        __moduleKey: 'mod',
        serverLoaders: { s: streamLoader },
      },
    };

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true })
    );
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'mod',
        loader: 's',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    // Drain the body so the SSE pump completes.
    await res.text();

    expect(events).toEqual([
      'start',
      'chunk:0:10',
      'chunk:1:20',
      'chunk:2:30',
      'end:3',
    ]);
  });

  it('fires onStart, onChunk per yield, and onEnd on a streaming action through pageActionHandler', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, { ok: true }>({
      onStart: () => events.push('start'),
      onChunk: (_ctx, chunk, i) => events.push(`chunk:${i}:${chunk}`),
      onEnd: (_ctx, info) => events.push(`end:${info.chunks}`),
      onError: () => events.push('error'),
    });

    async function* streamAction(): AsyncGenerator<
      number,
      { ok: true },
      unknown
    > {
      yield 1;
      yield 2;
      return { ok: true };
    }
    const wrapped = streamAction as typeof streamAction & {
      use?: ReadonlyArray<unknown>;
    };
    wrapped.use = [observer];

    const serverModule = {
      __moduleKey: 'mod',
      serverActions: { do: wrapped },
    };
    const serverRoutes = [
      {
        path: '/page',
        server: async () => serverModule,
        ancestors: [],
      },
    ];
    const resolvers = makePageActionResolvers(serverRoutes, { dev: true });
    const noopRender = async () => new Response('', { status: 200 });

    const app = new Hono().post(
      '*',
      pageActionHandler({
        resolverByPath: resolvers.byPath,
        renderPage: noopRender as never,
        resolvePageNode: () => null,
      })
    );
    const res = await app.request('/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ module: 'mod', action: 'do', payload: null }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(events).toEqual(['start', 'chunk:0:1', 'chunk:1:2', 'end:2']);
  });

  it('fires onError when a streaming loader throws partway', async () => {
    const events: string[] = [];
    const observer = defineStreamObserver<number, void>({
      onStart: () => events.push('start'),
      onChunk: (_c, ch) => events.push(`chunk:${ch}`),
      onError: (_c, err, info) =>
        events.push(`error:${(err as Error).message}:${info.chunks}`),
    });

    const streamLoader = defineLoader<number>(
      async function* () {
        yield 1;
        throw new Error('boom');
      },
      { __moduleKey: 'mod', __loaderName: 's', use: [observer] }
    );

    const serverModules: Record<string, unknown> = {
      mod: {
        __moduleKey: 'mod',
        serverLoaders: { s: streamLoader },
      },
    };

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true })
    );
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'mod',
        loader: 's',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(events).toEqual(['start', 'chunk:1', 'error:boom:1']);
  });
});

describe('E13: demo route-tree composition runs each gate once per request', () => {
  it('does not double-fire pageUse when sibling routes share a URL prefix', async () => {
    // Simulates the demo's `/demo/projects` (server) vs
    // `/demo/projects/:projectId/issues/:issueId` (server). Both have
    // pageUse = [requireSession]. Under the OLD URL-prefix logic, the
    // shared prefix would compose `/demo/projects`'s pageUse onto the
    // nested issue's chain -- making `requireSession` fire TWICE on every
    // issue request. The route-tree walker prevents that.
    const calls: number[] = [];
    const gate = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push(Date.now());
      await next();
    });

    const issueLoader = defineLoader<string>(async () => 'issue', {
      __moduleKey: 'issue',
      __loaderName: 'i',
    });
    const projectsServer = {
      __moduleKey: 'projects',
      pageUse: [gate],
    };
    const issueServer = {
      __moduleKey: 'issue',
      pageUse: [gate],
      serverLoaders: { i: issueLoader },
    };

    const serverModules: Record<string, unknown> = {
      'projects.server.ts': projectsServer,
      'issue.server.ts': issueServer,
    };

    const { byPath } = makePageUseResolvers([
      {
        path: '/demo/projects',
        server: async () => projectsServer,
        ancestors: [],
      },
      {
        path: '/demo/projects/:projectId/issues/:issueId',
        server: async () => issueServer,
        ancestors: [],
      },
    ]);

    const app = new Hono().post(
      '/__loaders',
      loadersHandler(serverModules, { dev: true, resolvePageUse: byPath })
    );
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'issue',
        loader: 'i',
        location: {
          path: '/demo/projects/abc/issues/123',
          pathParams: { projectId: 'abc', issueId: '123' },
          searchParams: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    // The gate must fire EXACTLY ONCE: only the leaf's own pageUse, not
    // the sibling /demo/projects's pageUse via URL-prefix conflation.
    expect(calls).toHaveLength(1);
  });
});
