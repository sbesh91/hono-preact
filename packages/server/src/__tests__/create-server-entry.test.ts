import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { h, type ComponentChildren } from 'preact';
import {
  defineServerMiddleware,
  defineLoader,
  defineChannel,
  defineRoom,
  type RoutesManifest,
} from '@hono-preact/iso';
import {
  _defineRouteLoader,
  _defineRouteSocket,
} from '@hono-preact/iso/internal';
import { SOCKETS_RPC_PATH } from '@hono-preact/iso/internal/runtime';
import { createServerEntry } from '../create-server-entry.js';

// A minimal RoutesManifest sufficient for the loader RPC path. The SSR (GET)
// and action paths are exercised end-to-end by the dogfood site build and the
// integration suite; these unit tests target the wiring guarantees that the
// generated entry used to verify only indirectly via generated-string asserts.
function manifest(
  parts: Partial<RoutesManifest> &
    Pick<RoutesManifest, 'serverImports' | 'routeUse'>
): RoutesManifest {
  return {
    tree: [],
    flat: [],
    serverRoutes: [],
    ...parts,
  };
}

// A trivial layout so createServerEntry's tree closure typechecks; the loader
// RPC and api-mount tests never render it.
const Layout = ({ children }: { children?: ComponentChildren }) =>
  h('div', null, children);

describe('createServerEntry', () => {
  it('threads the manifest routeUse page guard onto the loader RPC path (issue #122 parity)', async () => {
    const calls: string[] = [];
    const pageGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
      calls.push('page:before');
      await next();
      calls.push('page:after');
    });
    // _defineRouteLoader marks this as route-bound so the handler resolves its
    // page guards from the declared route (/x) rather than skipping the page tier.
    const loader = _defineRouteLoader(
      '/x',
      async () => {
        calls.push('inner');
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [pageGuard] }],
      }),
      layout: Layout,
      dev: true,
    });

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
    // The page guard from manifest.routeUse ran around the loader: proof that
    // createServerEntry wired makePageUseResolver(routes).byPath into the
    // loaders handler rather than composing a guard-less chain.
    expect(calls).toEqual(['page:before', 'inner', 'page:after']);
  });

  it('mounts the api app ahead of the reserved /__loaders path', async () => {
    let loadersRan = false;
    const blocked = defineServerMiddleware<'loader'>(async () => {});

    const api = new Hono();
    api.use('*', async (c, next) => {
      // Reject everything so we can prove the api layer runs first.
      if (new URL(c.req.url).pathname === '/__loaders') {
        return c.text('blocked-by-api', 403);
      }
      await next();
    });

    const loader = defineLoader<string>(
      async () => {
        loadersRan = true;
        return 'ok';
      },
      { __moduleKey: 'test/m', __loaderName: 'l', use: [] }
    );

    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [{ path: '/x', use: [blocked] }],
      }),
      layout: Layout,
      api,
      dev: true,
    });

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.text()).resolves.toBe('blocked-by-api');
    expect(loadersRan).toBe(false);
  });

  it('works without an api app', async () => {
    const loader = defineLoader<string>(async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [
          async () => ({ __moduleKey: 'test/m', serverLoaders: { l: loader } }),
        ],
        routeUse: [],
      }),
      layout: Layout,
      dev: true,
    });
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
  });

  it('fails closed (500) when a route-bound unit declares a route other than its mount', async () => {
    // A route-bound action stamped with a `__routeId` that does not match the
    // route its module is registered on: the binding guard must reject the POST
    // rather than let it resolve its page-use (auth) chain from the wrong route.
    const action = Object.defineProperty(async () => 'ok', '__routeId', {
      value: '/wrong',
      enumerable: false,
    });
    const serverThunk = async () => ({
      __moduleKey: 'test/m',
      serverActions: { go: action },
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [serverThunk],
        routeUse: [{ path: '/right', use: [] }],
        serverRoutes: [
          { path: '/right', ancestors: [], server: serverThunk } as never,
        ],
      }),
      layout: Layout,
      dev: true,
    });
    const res = await app.request('/right', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'test/m', action: 'go', payload: {} }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain("bound to route '/wrong'");
    expect(body.message).toContain("registered on route '/right'");
  });

  it('passes the binding guard when a route-bound unit matches its mount', async () => {
    const loader = _defineRouteLoader('/right', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const serverThunk = async () => ({
      __moduleKey: 'test/m',
      serverLoaders: { l: loader },
    });
    const app = createServerEntry({
      routes: manifest({
        serverImports: [serverThunk],
        routeUse: [{ path: '/right', use: [] }],
        serverRoutes: [
          { path: '/right', ancestors: [], server: serverThunk } as never,
        ],
      }),
      layout: Layout,
      dev: true,
    });
    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/right', pathParams: {}, searchParams: {} },
      }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBe('ok');
  });

  it('wires the bare-loader guarded-route dev warning (dev: true)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pageGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
        await next();
      });
      const app = createServerEntry({
        routes: manifest({
          serverImports: [
            async () => ({
              __moduleKey: 'test/bare',
              serverLoaders: { l: async () => 'ok' },
            }),
          ],
          routeUse: [{ path: '/x', use: [pageGuard] }],
        }),
        layout: Layout,
        dev: true,
      });
      const res = await app.request('/__loaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'test/bare',
          loader: 'l',
          location: { path: '/x', pathParams: {}, searchParams: {} },
        }),
      });
      expect(res.status).toBe(200);
      const warnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes('bare loader')
      );
      expect(warnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('fails the socket upgrade closed (500) when a registry socket is misbound', async () => {
    // A src/server registry socket bound to a pattern that is not in the route
    // table. Before this gate, /__sockets never ran the binding check, so the
    // misbinding surfaced (at best) as a silently gateless connection.
    const app = createServerEntry({
      routes: manifest({
        serverImports: [],
        routeUse: [{ path: '/x', use: [] }],
      }),
      layout: Layout,
      serverRegistry: [
        async () => ({
          __moduleKey: 'src/server/rt',
          serverSockets: { feed: _defineRouteSocket('/nope', {}) },
        }),
      ],
      dev: true,
    });

    const res = await app.request(
      `${SOCKETS_RPC_PATH}?m=${encodeURIComponent('src/server/rt')}&s=feed`
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/socket 'feed'/);
    expect(body.error).toMatch(/'\/nope'/);
  });

  it('prod mode: the socket gate fails closed and re-fails on repeat requests (clear-on-reject)', async () => {
    const app = createServerEntry({
      routes: manifest({
        serverImports: [],
        routeUse: [{ path: '/x', use: [] }],
      }),
      layout: Layout,
      serverRegistry: [
        async () => ({
          __moduleKey: 'src/server/rt',
          serverSockets: { feed: _defineRouteSocket('/nope', {}) },
        }),
      ],
      // dev omitted: prod caching (memoized boot check with clear-on-reject).
    });

    const url = `${SOCKETS_RPC_PATH}?m=${encodeURIComponent('src/server/rt')}&s=feed`;
    const first = await app.request(url);
    expect(first.status).toBe(500);
    const firstBody = (await first.json()) as { error: string };
    expect(firstBody.error).toMatch(/socket 'feed'/);
    // A rejected check must not be cached as passed: the second request
    // re-runs the boot checks and fails closed again.
    const second = await app.request(url);
    expect(second.status).toBe(500);
    const secondBody = (await second.json()) as { error: string };
    expect(secondBody.error).toMatch(/socket 'feed'/);
  });

  it('fails the socket upgrade closed (500) when ONLY the app-use tier is live for a room param-congruence mismatch (round-4 auth-fix pin)', async () => {
    // `appUse: appConfig.use ?? []` (create-server-entry.ts) is the ONLY
    // wiring that threads defineApp's app-level `use` into the room
    // route/channel congruence check. Deleting that line is not a type
    // error (appUse is optional on RouteBindingCheckContext) and every
    // other test in the suite still passes, so the auth-hole fix it pins
    // has zero coverage without this end-to-end test: a route with an
    // EMPTY page-use chain, an app tier that is genuinely non-empty, and a
    // colocated room whose channel does not carry the route's param must
    // still fail the boot closed.
    const appGuard = defineServerMiddleware<'loader'>(async (_c, next) => {
      await next();
    });
    // A colocated room (no serverRoute binding): its effective owning route
    // is the module mount, '/board/:id'. Its channel is route-independent
    // ('global-chat'), so the route's required 'id' param is not a channel
    // key -- a real, boot-rejected mismatch once ANY guard tier is live.
    const channel = defineChannel('global-chat')();
    const roomDef = defineRoom(channel, {});
    const serverThunk = async () => ({
      __moduleKey: 'pages/board',
      serverRooms: { chat: roomDef },
    });

    const app = createServerEntry({
      routes: manifest({
        serverImports: [serverThunk],
        // Page-use is EMPTY: if appUse were dropped, all three tiers the
        // congruence check inspects would read as empty and the boot would
        // wrongly pass (the round-4 regression this test pins).
        routeUse: [{ path: '/board/:id', use: [] }],
        serverRoutes: [
          { path: '/board/:id', ancestors: [], server: serverThunk } as never,
        ],
      }),
      layout: Layout,
      appConfig: { use: [appGuard] },
      dev: true,
    });

    const res = await app.request(
      `${SOCKETS_RPC_PATH}?m=${encodeURIComponent('pages/board')}&s=chat`
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/room 'chat'/);
    expect(body.error).toMatch(/not a key of channel/);
  });
});

describe('aliased exact layout binding dev warning', () => {
  const buildApp = (dev: boolean) => {
    const layoutGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const indexGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const loader = _defineRouteLoader('/x', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const mod = { __moduleKey: 'test/m', serverLoaders: { l: loader } };
    return createServerEntry({
      routes: manifest({
        serverImports: [async () => mod],
        serverRoutes: [{ path: '/x', server: async () => mod, ancestors: [] }],
        routeUse: [
          { path: '/x', use: [layoutGate, indexGate] },
          { path: '/x/*', use: [layoutGate] },
        ],
      }),
      layout: Layout,
      dev,
    });
  };
  const post = (app: ReturnType<typeof buildApp>) =>
    app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
  const aliasWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
    calls.filter((c) => String(c[0]).includes('page scope'));

  it('dev warns once per binding across requests, naming both spellings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(true);
      await post(app);
      await post(app);
      const warnings = aliasWarnings(warn.mock.calls);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0][0])).toContain("serverRoute('/x/*')");
    } finally {
      warn.mockRestore();
    }
  });

  it('prod never warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(false);
      await post(app);
      expect(aliasWarnings(warn.mock.calls)).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
