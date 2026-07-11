import { describe, expect, it, vi } from 'vitest';
import {
  assertRouteBindingsMatchMount,
  assertRegistryRouteBindingsValid,
  warnAliasedLayoutBinding,
  type RouteBindingCheckContext,
  type AliasedBindingInfo,
} from '../route-binding-guard.js';
import type { ServerRoute } from '@hono-preact/iso';

// A route-bound export carries a non-enumerable `__routeId`; mirror that here.
const bound = (routeId: string, fn: () => unknown = async () => 'ok') =>
  Object.defineProperty(fn, '__routeId', { value: routeId, enumerable: false });

const routeOf = (path: string, mod: Record<string, unknown>): ServerRoute =>
  ({ path, ancestors: [], server: async () => mod }) as unknown as ServerRoute;

const ctxOf = (
  entries: ReadonlyArray<[string, ReadonlyArray<unknown>]>
): RouteBindingCheckContext => ({ routeUseByPattern: new Map(entries) });

describe('assertRouteBindingsMatchMount', () => {
  it('passes when every route-bound unit matches its mount path', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        serverLoaders: { default: bound('/movies/:id') },
        serverActions: { rate: bound('/movies/:id') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).resolves.toBeUndefined();
  });

  it('passes for bare (route-independent) units with no __routeId', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        serverLoaders: { default: async () => 'ok' },
        serverActions: { rate: async () => 'ok' },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).resolves.toBeUndefined();
  });

  it('throws when a route-bound action is bound to a different route than its mount', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        // Mounted on /movies/:id but bound to the (weaker) parent route.
        serverActions: { rate: bound('/movies') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).rejects.toThrow(
      /action 'rate' is bound to route '\/movies', but its module is registered on route '\/movies\/:id'/
    );
  });

  it('throws when a route-bound loader is bound to a different route than its mount', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        serverLoaders: { default: bound('/somewhere/else') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).rejects.toThrow(
      /Route-bound loader 'default' is bound to route '\/somewhere\/else'/
    );
  });

  it('ignores modules with no server units', async () => {
    const routes = [routeOf('/x', { __moduleKey: 'm' })];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/x', []]]))
    ).resolves.toBeUndefined();
  });
});

describe('assertRegistryRouteBindingsValid', () => {
  const registryOf = (mod: Record<string, unknown>) => [async () => mod];
  const ctx = ctxOf([
    ['/reports', []],
    ['/reports/:id', []],
  ]);

  it('passes for route-less registry modules (bare units)', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: async () => 'ok' },
      serverActions: { export: async () => 'ok' },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, ctx)
    ).resolves.toBeUndefined();
  });

  it('passes for an empty registry', async () => {
    await expect(
      assertRegistryRouteBindingsValid([], ctx)
    ).resolves.toBeUndefined();
  });

  it('passes when a route-bound unit targets a real route pattern', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: bound('/reports') },
      serverActions: { archive: bound('/reports/:id') },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, ctx)
    ).resolves.toBeUndefined();
  });

  it('throws when a route-bound loader targets a route not in the table', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: bound('/nope') },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, ctx)
    ).rejects.toThrow(
      /Route-bound loader 'totals' in the src\/server registry is bound to route '\/nope', which is not a route/
    );
  });

  it('throws when a route-bound action targets a route not in the table', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverActions: { archive: bound('/reports/:id/extra') },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, ctx)
    ).rejects.toThrow(
      /Route-bound action 'archive'.*is not a route in your route table/s
    );
  });
});

describe('subtree (wildcard) bindings', () => {
  it('mount accepts <path>/* when the subtree key exists', async () => {
    const routes = [
      routeOf('/movies', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/movies/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(
        routes,
        ctxOf([
          ['/movies', []],
          ['/movies/*', []],
        ])
      )
    ).resolves.toBeUndefined();
  });

  it('mount rejects <path>/* on a childless route (fail closed)', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/movies/:id/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).rejects.toThrow(
      /binds the subtree pattern '\/movies\/:id\/\*', but route '\/movies\/:id' has no child routes/
    );
  });

  it('mount still rejects a wildcard naming a DIFFERENT route', async () => {
    const routes = [
      routeOf('/movies', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/other/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(
        routes,
        ctxOf([
          ['/movies', []],
          ['/movies/*', []],
        ])
      )
    ).rejects.toThrow(
      /is bound to route '\/other\/\*', but its module is registered on route '\/movies'/
    );
  });

  it('registry accepts a subtree binding whose key exists', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/reports',
        serverLoaders: { totals: bound('/reports/*') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(
        registry,
        ctxOf([
          ['/reports', []],
          ['/reports/*', []],
        ])
      )
    ).resolves.toBeUndefined();
  });

  it('registry rejects a subtree binding with no such key', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/reports',
        serverLoaders: { totals: bound('/nope/*') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/reports', []]]))
    ).rejects.toThrow(/bound to route '\/nope\/\*', which is not a route/);
  });
});

describe('aliasing diagnostic (onAliasedBinding)', () => {
  const g1 = () => {};
  const g2 = () => {};
  const collect = () => {
    const seen: AliasedBindingInfo[] = [];
    return { seen, cb: (info: AliasedBindingInfo) => seen.push(info) };
  };

  it('reports an exact binding whose chain strictly extends the sibling subtree chain', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverLoaders: { shell: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([
      { kind: 'loader', name: 'shell', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });

  it('does not report when the subtree chain is the wider one (catch-all collision)', async () => {
    // A literal `path: '*'` child overwrites the subtree key with the child's
    // own composed chain, so the SUBTREE chain extends the exact chain. The
    // exact binding already runs exactly the page's own chain; no aliasing.
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverLoaders: { shell: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1]],
          ['/app/*', [g1, g2]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report same-length chains that differ (no prefix extension)', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverLoaders: { shell: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report when the two chains are identical', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverLoaders: { shell: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report a subtree binding (it IS the subtree scope)', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverLoaders: { shell: bound('/app/*') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report when no sibling subtree key exists (leaf binding)', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [
        routeOf('/leaf', {
          __moduleKey: 'm',
          serverLoaders: { l: bound('/leaf') },
        }),
      ],
      { routeUseByPattern: new Map([['/leaf', [g1]]]), onAliasedBinding: cb }
    );
    expect(seen).toEqual([]);
  });

  it('reports registry bindings through the same signal', async () => {
    const { seen, cb } = collect();
    await assertRegistryRouteBindingsValid(
      [
        async () => ({
          __moduleKey: 'src/server/x',
          serverActions: { save: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([
      { kind: 'action', name: 'save', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });
});

describe('warnAliasedLayoutBinding', () => {
  it('warns once per binding key, naming both spellings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warned = new Set<string>();
      const info: AliasedBindingInfo = {
        kind: 'loader',
        name: 'shell',
        routeId: '/app',
        subtreeId: '/app/*',
      };
      warnAliasedLayoutBinding(warned, info);
      warnAliasedLayoutBinding(warned, info);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain("'/app'");
      expect(msg).toContain("serverRoute('/app/*')");
      expect(msg).toContain('page scope');
      // The wildcard hint points at tree-form registration, under which
      // every children-bearing node's subtree spelling is typed.
      expect(msg).toContain('tree: typeof routeTree');
    } finally {
      warn.mockRestore();
    }
  });
});
