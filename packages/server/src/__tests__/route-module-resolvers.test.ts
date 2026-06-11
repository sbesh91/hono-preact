import { describe, it, expect } from 'vitest';
import type { ServerRoute } from '@hono-preact/iso';
import { makeRouteModuleResolvers } from '../route-module-resolvers.js';

type TestMod = { tag?: string };

function countingThunk(tag: string, calls: { n: number }) {
  return () => {
    calls.n++;
    return Promise.resolve({ tag });
  };
}

/** Strategy that composes the loaded tags outer-first into one array. */
const tagStrategy = {
  createExtra: () => new Map<string, string>(),
  compose: (
    route: ServerRoute,
    ancestorMods: ReadonlyArray<TestMod>,
    selfMod: TestMod,
    extra: Map<string, string>
  ) => {
    const tags = [...ancestorMods, selfMod].map((m) => m.tag ?? '?');
    extra.set(route.path, tags.join('+'));
    return tags;
  },
};

describe('makeRouteModuleResolvers', () => {
  it('loads each distinct thunk exactly once per build (server + ancestor reuse)', async () => {
    const calls = { n: 0 };
    const layout = countingThunk('layout', calls);
    const leaf = countingThunk('leaf', calls);
    const routes: ServerRoute[] = [
      { path: '/g', server: layout, ancestors: [] },
      { path: '/g/leaf', server: leaf, ancestors: [layout] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    expect(await core.byPath('/g/leaf')).toEqual(['layout', 'leaf']);
    expect(calls.n).toBe(2);
  });

  it('caches the build across calls when dev is false', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/a', server: countingThunk('a', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    await core.byPath('/a');
    await core.byPath('/a');
    await core.built();
    expect(calls.n).toBe(1);
  });

  it('rebuilds on every call when dev is true', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/a', server: countingThunk('a', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, { dev: true }, tagStrategy);
    await core.byPath('/a');
    await core.byPath('/a');
    expect(calls.n).toBe(2);
  });

  it('does not cache a failed build: the next call retries and can succeed', async () => {
    let failOnce = true;
    const calls = { n: 0 };
    const flaky = () => {
      calls.n++;
      if (failOnce) {
        failOnce = false;
        return Promise.reject(new Error('transient import error'));
      }
      return Promise.resolve({ tag: 'ok' });
    };
    const routes: ServerRoute[] = [
      { path: '/a', server: flaky, ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    await expect(core.byPath('/a')).rejects.toThrow('transient import error');
    expect(await core.byPath('/a')).toEqual(['ok']);
    expect(calls.n).toBe(2);
  });

  it('byPath resolves through findBestPattern and returns undefined on no match', async () => {
    const calls = { n: 0 };
    const routes: ServerRoute[] = [
      { path: '/p/:id', server: countingThunk('param', calls), ancestors: [] },
      { path: '/p/new', server: countingThunk('lit', calls), ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    expect(await core.byPath('/p/new')).toEqual(['lit']);
    expect(await core.byPath('/p/42')).toEqual(['param']);
    expect(await core.byPath('/nope')).toBeUndefined();
  });

  it('concurrent first calls share one in-flight build', async () => {
    const calls = { n: 0 };
    let release!: (mod: TestMod) => void;
    const gated = () => {
      calls.n++;
      return new Promise<TestMod>((resolve) => {
        release = resolve;
      });
    };
    const routes: ServerRoute[] = [
      { path: '/a', server: gated, ancestors: [] },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    const first = core.byPath('/a');
    const second = core.byPath('/a');
    // Flush enough microtasks for build() to reach the gated thunk before
    // we release it (the thunk is called inside an async Promise.all body).
    await Promise.resolve();
    release({ tag: 'a' });
    expect(await first).toEqual(['a']);
    expect(await second).toEqual(['a']);
    expect(calls.n).toBe(1);
  });

  it('built() exposes the byPathMap and the strategy-accumulated extra', async () => {
    const calls = { n: 0 };
    const layout = countingThunk('layout', calls);
    const routes: ServerRoute[] = [
      {
        path: '/g/leaf',
        server: countingThunk('leaf', calls),
        ancestors: [layout],
      },
    ];
    const core = makeRouteModuleResolvers<
      TestMod,
      string[],
      Map<string, string>
    >(routes, {}, tagStrategy);
    const { byPathMap, extra } = await core.built();
    expect(byPathMap.get('/g/leaf')).toEqual(['layout', 'leaf']);
    expect(extra.get('/g/leaf')).toBe('layout+leaf');
  });
});
