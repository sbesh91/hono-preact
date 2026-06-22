import { describe, expect, it } from 'vitest';
import { makePageActionResolvers } from '../page-action-resolvers.js';
import type { ServerRoute } from '@hono-preact/iso';

const layoutAction = async () => 'layout-result';
const pageAction = async () => 'page-result';

const layoutThunk = async () => ({
  __moduleKey: 'pages/_layout.server',
  serverActions: { logout: layoutAction },
});
const pageThunk = async () => ({
  __moduleKey: 'pages/foo.server',
  serverActions: { submit: pageAction },
});

const routes: ServerRoute[] = [
  {
    path: '/foo',
    server: pageThunk,
    ancestors: [layoutThunk],
  } as unknown as ServerRoute,
];

describe('makePageActionResolvers', () => {
  it('byPath includes both page and ancestor actions', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect([...map.keys()].sort()).toEqual(['logout', 'submit']);
    expect(map.get('submit')?.moduleKey).toBe('pages/foo.server');
    expect(map.get('logout')?.moduleKey).toBe('pages/_layout.server');
  });

  it('byModuleKey returns the per-action entry for that module', async () => {
    const { byModuleKey } = makePageActionResolvers(routes, { dev: false });
    const entry = await byModuleKey('pages/foo.server', 'submit');
    expect(entry).toBeTruthy();
    expect(entry?.moduleKey).toBe('pages/foo.server');
  });

  it('returns undefined when the action name does not exist on the chain', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect(map.get('nope')).toBeUndefined();
  });

  it('rebuilds on every call in dev mode', async () => {
    let calls = 0;
    const dynamicThunk = async () => {
      calls++;
      return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
    };
    const dynamicRoutes: ServerRoute[] = [
      {
        path: '/p',
        server: dynamicThunk,
        ancestors: [],
      } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(dynamicRoutes, { dev: true });
    await byPath('/p');
    await byPath('/p');
    expect(calls).toBe(2);
  });

  it('loads each distinct thunk exactly once per build (server + ancestor reuse)', async () => {
    const calls = { n: 0 };
    const layout = async () => {
      calls.n++;
      return { __moduleKey: 'l', serverActions: { a: async () => 'a' } };
    };
    const leaf = async () => {
      calls.n++;
      return { __moduleKey: 'p', serverActions: { b: async () => 'b' } };
    };
    const r: ServerRoute[] = [
      { path: '/g', server: layout, ancestors: [] } as unknown as ServerRoute,
      {
        path: '/g/leaf',
        server: leaf,
        ancestors: [layout],
      } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    const map = await byPath('/g/leaf');
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
    expect(calls.n).toBe(2); // layout loaded once despite being self + ancestor
  });

  it('caches the build across calls when dev is false', async () => {
    let calls = 0;
    const thunk = async () => {
      calls++;
      return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
    };
    const r: ServerRoute[] = [
      { path: '/a', server: thunk, ancestors: [] } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    await byPath('/a');
    await byPath('/a');
    expect(calls).toBe(1);
  });

  it('does not cache a failed build: the next call retries and can succeed', async () => {
    let failOnce = true;
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (failOnce) {
        failOnce = false;
        throw new Error('transient import error');
      }
      return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
    };
    const r: ServerRoute[] = [
      { path: '/a', server: flaky, ancestors: [] } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    await expect(byPath('/a')).rejects.toThrow('transient import error');
    const map = await byPath('/a');
    expect([...map.keys()]).toEqual(['x']);
    expect(calls).toBe(2);
  });

  it('byPath resolves through findBestPattern and returns an empty map on no match', async () => {
    const r: ServerRoute[] = [
      {
        path: '/p/:id',
        server: async () => ({
          __moduleKey: 'param',
          serverActions: { p: async () => 'param' },
        }),
        ancestors: [],
      } as unknown as ServerRoute,
      {
        path: '/p/new',
        server: async () => ({
          __moduleKey: 'lit',
          serverActions: { l: async () => 'lit' },
        }),
        ancestors: [],
      } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    expect((await byPath('/p/new')).get('l')?.moduleKey).toBe('lit'); // literal beats param
    expect((await byPath('/p/42')).get('p')?.moduleKey).toBe('param');
    expect([...(await byPath('/nope')).keys()]).toEqual([]); // empty map, no match
  });

  it('byPath returns guards for a param-absent URL on a trailing-optional route', async () => {
    // Regression: /files/:id? must resolve for /files so the action's `use`
    // guards survive. Before the matcher fix this returned an empty map,
    // silently dropping server-side guards (an edge-case guard bypass).
    const guard = async () => {};
    const remove = Object.assign(async () => 'ok', { use: [guard] });
    const r: ServerRoute[] = [
      {
        path: '/files/:id?',
        server: async () => ({
          __moduleKey: 'files',
          serverActions: { remove },
        }),
        ancestors: [],
      } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    const absent = await byPath('/files');
    expect(absent.get('remove')?.use).toEqual([guard]); // guards survive, not dropped
    const present = await byPath('/files/42');
    expect(present.get('remove')?.use).toEqual([guard]);
  });

  it('reads the input schema off a defineAction value into the entry', async () => {
    // Build a fake server module whose serverActions carries a fn with a
    // non-enumerable `input` (as defineAction attaches it).
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (v: unknown) => ({ value: v }),
      },
    };
    const fn = async () => 'ok';
    Object.defineProperty(fn, 'input', { value: schema, enumerable: false });
    const resolvers = makePageActionResolvers(
      [
        {
          path: '/foo',
          ancestors: [],
          server: async () => ({
            __moduleKey: 'pages/foo.server',
            serverActions: { submit: fn },
          }),
        } as never,
      ],
      { dev: true }
    );
    const entry = await resolvers.byModuleKey('pages/foo.server', 'submit');
    expect(entry?.input).toBe(schema);
  });

  it('concurrent first calls share one in-flight build', async () => {
    let calls = 0;
    let release!: (mod: unknown) => void;
    const gated = () => {
      calls++;
      return new Promise<unknown>((resolve) => {
        release = resolve;
      });
    };
    const r: ServerRoute[] = [
      { path: '/a', server: gated, ancestors: [] } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(r, { dev: false });
    const first = byPath('/a');
    const second = byPath('/a');
    await Promise.resolve();
    release({ __moduleKey: 'p', serverActions: { x: async () => 'ok' } });
    expect([...(await first).keys()]).toEqual(['x']);
    expect([...(await second).keys()]).toEqual(['x']);
    expect(calls).toBe(1);
  });
});
