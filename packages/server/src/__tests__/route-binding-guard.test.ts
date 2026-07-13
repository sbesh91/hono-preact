import { describe, expect, it, vi } from 'vitest';
import {
  assertRouteBindingsMatchMount,
  assertRegistryRouteBindingsValid,
  warnAliasedLayoutBinding,
  warnRoomParamBinding,
  type RouteBindingCheckContext,
  type AliasedBindingInfo,
  type RoomParamBindingInfo,
  type RoomParamExemptionInfo,
} from '../route-binding-guard.js';
import {
  defineRoutes,
  defineServerMiddleware,
  defineClientMiddleware,
} from '@hono-preact/iso';
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

describe('root-layout bindings (real manifest)', () => {
  // These run against a real defineRoutes manifest rather than stub
  // ServerRoutes: the point is that the runtime keys (serverRoutes paths +
  // routeUse patterns) agree with the typed '/x' spelling for children of a
  // root '/' node, so the boot checks accept exactly what the types accept.
  const noopView = () => Promise.resolve({ default: () => null });
  const noopLayout = () => Promise.resolve({ default: () => null });
  const gate = defineServerMiddleware(async (_c, next) => next());

  const manifestFor = (server?: () => Promise<unknown>) =>
    defineRoutes([
      {
        path: '/',
        layout: noopLayout,
        use: [gate],
        children: [
          { path: '', view: noopView },
          { path: 'x', view: noopView, ...(server ? { server } : {}) },
        ],
      },
    ]);

  const ctxFor = (m: ReturnType<typeof manifestFor>) => ({
    routeUseByPattern: new Map(m.routeUse.map((r) => [r.path, r.use])),
  });

  it("mount accepts serverRoute('/x') colocated under a root layout", async () => {
    const mod = {
      __moduleKey: 'pages/x',
      serverLoaders: { data: bound('/x') },
    };
    const m = manifestFor(async () => mod);
    const ctx = ctxFor(m);
    await expect(
      assertRouteBindingsMatchMount(m.serverRoutes, ctx)
    ).resolves.toBeUndefined();
    // The accepted binding's exact key resolves the root node's gate chain,
    // so the RPC path runs the gate rather than an empty chain.
    expect(ctx.routeUseByPattern.get('/x')).toEqual([gate]);
  });

  it("registry accepts bindings to '/x' and the root subtree '/*'", async () => {
    const m = manifestFor();
    const registry = [
      async () => ({
        __moduleKey: 'src/server/reg',
        serverLoaders: { data: bound('/x'), shell: bound('/*') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxFor(m))
    ).resolves.toBeUndefined();
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

describe('socket/room bindings (serverSockets / serverRooms containers)', () => {
  // Socket/room defs are objects, not fns; mirror the file's `bound` helper.
  const boundDef = (routeId: string): Record<string, unknown> =>
    Object.defineProperty({ open() {} }, '__routeId', {
      value: routeId,
      enumerable: false,
    });

  it('mount passes when a bound socket matches its mount path', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/chat') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('mount throws when a bound socket declares a different route', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/other') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /Route-bound socket 'feed' is bound to route '\/other', but its module is registered on route '\/chat'/
    );
  });

  it('mount throws when a bound room declares a different route', async () => {
    const routes = [
      routeOf('/board', {
        __moduleKey: 'm',
        serverRooms: { board: boundDef('/elsewhere') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board', []]]))
    ).rejects.toThrow(
      /Route-bound room 'board' is bound to route '\/elsewhere'/
    );
  });

  it('mount rejects a socket subtree binding on a childless route (fail closed)', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/chat/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /socket 'feed' binds the subtree pattern '\/chat\/\*', but route '\/chat' has no child routes/
    );
  });

  it('mount rejects a room subtree binding on a childless route (fail closed)', async () => {
    const routes = [
      routeOf('/board', {
        __moduleKey: 'm',
        serverRooms: { board: boundDef('/board/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board', []]]))
    ).rejects.toThrow(
      /room 'board' binds the subtree pattern '\/board\/\*', but route '\/board' has no child routes/
    );
  });

  it('registry throws when a bound socket targets a route not in the table', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverSockets: { feed: boundDef('/nope') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /Route-bound socket 'feed' in the src\/server registry is bound to route '\/nope', which is not a route/
    );
  });

  it('registry throws when a bound room targets a route not in the table', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverRooms: { board: boundDef('/nope') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).rejects.toThrow(/Route-bound room 'board'/);
  });

  it('registry passes when bound socket/room target real patterns', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverSockets: { feed: boundDef('/chat') },
        serverRooms: { board: boundDef('/chat') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('bare (unstamped) socket/room defs are skipped', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: { open() {} } },
        serverRooms: { board: { onJoin() {} } },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('aliasing diagnostic reports kind socket and room', async () => {
    const g1 = () => {};
    const g2 = () => {};
    const seen: AliasedBindingInfo[] = [];
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverSockets: { feed: boundDef('/app') },
          serverRooms: { board: boundDef('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: (info) => seen.push(info),
      }
    );
    // CONTAINERS order: loaders, actions, sockets, rooms.
    expect(seen).toEqual([
      { kind: 'socket', name: 'feed', routeId: '/app', subtreeId: '/app/*' },
      { kind: 'room', name: 'board', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });
});

describe('bound route param conformance (socket/room :param spelling)', () => {
  // Socket/room defs are objects, not fns; mirrors the file's `bound` helper
  // (see the 'socket/room bindings' describe block above for the original).
  const boundDef = (routeId: string): Record<string, unknown> =>
    Object.defineProperty({ open() {} }, '__routeId', {
      value: routeId,
      enumerable: false,
    });

  // RouteParams<'/board/:board-id'> and preact-iso's own `exec` matcher both
  // bind ':board-id' fine, but PARAM_SEGMENT (requiredParamSlots /
  // declaredParamSlots) does not: a route-bound socket/room on this route
  // would require nothing and hand its page-use guard '{}' for a param the
  // SAME guard sees populated over plain HTTP. This must throw at boot, even
  // though the routeId matches its own module mount exactly (so the
  // pre-existing mount-match check alone would pass it clean).
  it('mount throws for a bound socket on a route with a hyphenated param', async () => {
    const routes = [
      routeOf('/board/:board-id', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/board/:board-id') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:board-id', []]]))
    ).rejects.toThrow(
      /socket 'feed' binds route '\/board\/:board-id'.*':board-id'.*\[A-Za-z0-9_\]/s
    );
  });

  it('mount throws for a bound room on a route with a hyphenated param', async () => {
    const routes = [
      routeOf('/board/:board-id', {
        __moduleKey: 'm',
        serverRooms: { cursors: boundDef('/board/:board-id') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:board-id', []]]))
    ).rejects.toThrow(
      /room 'cursors' binds route '\/board\/:board-id'.*':board-id'.*\[A-Za-z0-9_\]/s
    );
  });

  it('mount throws for a colon not at the segment start (board:boardId)', async () => {
    const routes = [
      routeOf('/board:boardId', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/board:boardId') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board:boardId', []]]))
    ).rejects.toThrow(/socket 'feed' binds route '\/board:boardId'/);
  });

  it('does NOT throw for an ordinary loader/action on the SAME non-conforming route', async () => {
    // Loaders/actions read pathParams from the request URL via preact-iso's
    // own (wider) `exec` matcher, so a hyphenated route param already works
    // correctly for them; only socket/room are scoped by this check. An
    // existing app may legitimately have this HTTP route today.
    const routes = [
      routeOf('/board/:board-id', {
        __moduleKey: 'm',
        serverLoaders: { default: bound('/board/:board-id') },
        serverActions: { save: bound('/board/:board-id') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:board-id', []]]))
    ).resolves.toBeUndefined();
  });

  it('does NOT throw for a colocated (unbound) socket/room on the SAME non-conforming route', async () => {
    const routes = [
      routeOf('/board/:board-id', {
        __moduleKey: 'm',
        serverSockets: { feed: { open() {} } },
        serverRooms: { cursors: { onJoin() {} } },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:board-id', []]]))
    ).resolves.toBeUndefined();
  });

  it('registry throws for a bound room whose route has a non-conforming param', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverRooms: { cursors: boundDef('/board/:board-id') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(
        registry,
        ctxOf([['/board/:board-id', []]])
      )
    ).rejects.toThrow(/room 'cursors' binds route '\/board\/:board-id'/);
  });

  it('registry does NOT throw for a bound loader on the same non-conforming route', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverLoaders: { totals: bound('/board/:board-id') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(
        registry,
        ctxOf([['/board/:board-id', []]])
      )
    ).resolves.toBeUndefined();
  });
});

describe('room route/channel param congruence', () => {
  // A real server middleware, standing in for a page-use guard: the
  // congruence throw is scoped to routes that have a LIVE (server) guard
  // tier (P2-a), so these fixtures give '/board/:id' a non-empty chain
  // wherever the test means to pin the throw. Tier liveness now counts only
  // `runs === 'server'` entries (see `isServerMiddleware` in
  // route-binding-guard.ts), so a bare function no longer counts as a guard;
  // this must be a real `defineServerMiddleware` object.
  const guard = defineServerMiddleware(async (_c, next) => next());

  // A room whose route requires :id but whose channel keys on :boardId fails
  // boot, PROVIDED the route has a guard that could read the missing param.
  it('throws when a bound room route param is absent from the channel (route has a guard)', async () => {
    const roomMod = async () => ({
      serverRooms: {
        cursors: {
          __routeId: '/board/:id',
          channel: { name: 'board/:boardId' },
        },
      },
    });
    await expect(
      assertRegistryRouteBindingsValid([roomMod], {
        routeUseByPattern: new Map([['/board/:id', [guard]]]),
      })
    ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
  });

  // Congruent names pass and fire the dev advisory once.
  it('passes on route ⊆ channel and fires the param advisory', async () => {
    const roomMod = async () => ({
      serverRooms: {
        cursors: { __routeId: '/board/:id', channel: { name: 'board/:id' } },
      },
    });
    const seen: Array<{ name: string; routeId: string; params: string[] }> = [];
    await assertRegistryRouteBindingsValid([roomMod], {
      routeUseByPattern: new Map([['/board/:id', []]]),
      onRoomParamBinding: (info) => seen.push(info),
    });
    expect(seen).toEqual([
      { name: 'cursors', routeId: '/board/:id', params: ['id'] },
    ]);
  });

  it('checks a colocated room (no __routeId) against its module mount (route has a guard)', async () => {
    const routes = [
      routeOf('/board/:id', {
        __moduleKey: 'm',
        serverRooms: { cursors: { channel: { name: 'board/:boardId' } } },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:id', [guard]]]))
    ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
  });

  // A room misbound to an unrelated route must report the MISBINDING error,
  // not a congruence error computed against a pattern the room was never
  // even bound to. The mount check runs FIRST regardless of the mount
  // route's guard chain, so this must throw the misbinding error even with
  // '/board/:id' guard-less; the misbinding is the more actionable, sharper
  // diagnostic and must win either way.
  it('reports misbinding (not congruence) for a room bound to a different route than its mount', async () => {
    const routes = [
      routeOf('/board/:id', {
        __moduleKey: 'm',
        serverRooms: {
          cursors: { __routeId: '/other/:x', channel: { name: 'cursors' } },
        },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board/:id', []]]))
    ).rejects.toThrow(
      /room 'cursors' is bound to route '\/other\/:x', but its module is registered on route '\/board\/:id'/
    );
  });

  it('does not check a bare registry room (no __routeId, route-independent)', async () => {
    const registry = [
      async () => ({
        serverRooms: { cursors: { channel: { name: 'board/:boardId' } } },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([]))
    ).resolves.toBeUndefined();
  });

  // The channel may be finer-grained than the route (channel params ⊇ route
  // params): a route bound to '/board/:id' may key its channel on a nested
  // resource like a thread, as long as it still carries the route's own
  // params. This must not throw, and the advisory must report only the
  // ROUTE's params, not the channel's extras.
  it('passes when the channel carries params beyond the route (finer-grained channel)', async () => {
    const roomMod = async () => ({
      serverRooms: {
        cursors: {
          __routeId: '/board/:id',
          channel: { name: 'board/:id/thread/:threadId' },
        },
      },
    });
    const seen: Array<{ name: string; routeId: string; params: string[] }> = [];
    await expect(
      assertRegistryRouteBindingsValid([roomMod], {
        routeUseByPattern: new Map([['/board/:id', []]]),
        onRoomParamBinding: (info) => seen.push(info),
      })
    ).resolves.toBeUndefined();
    expect(seen).toEqual([
      { name: 'cursors', routeId: '/board/:id', params: ['id'] },
    ]);
  });

  // A param-less route (e.g. '/chat') has no route params to satisfy, so the
  // congruence check early-returns: no throw, and the advisory never fires
  // (there is nothing to report a correspondence for).
  it('does not throw or fire the advisory for a param-less route', async () => {
    const roomMod = async () => ({
      serverRooms: {
        cursors: { __routeId: '/chat', channel: { name: 'chat/:msgId' } },
      },
    });
    const seen: Array<{ name: string; routeId: string; params: string[] }> = [];
    await expect(
      assertRegistryRouteBindingsValid([roomMod], {
        routeUseByPattern: new Map([['/chat', []]]),
        onRoomParamBinding: (info) => seen.push(info),
      })
    ).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  describe('P2-a: congruence throw is scoped to guarded routes', () => {
    // A deliberately route-independent room (e.g. defineChannel('global-chat')
    // colocated under /board/:id's .server.ts) is a real, working v0.9/v0.10
    // configuration: no guard on the route could ever read the missing 'id'
    // param, because the route has NO guard at all. Skip the throw.
    it('does not throw for a colocated room on a GUARD-LESS param route, even though names diverge', async () => {
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: { chat: { channel: { name: 'global-chat' } } },
        }),
      ];
      await expect(
        assertRouteBindingsMatchMount(routes, ctxOf([['/board/:id', []]]))
      ).resolves.toBeUndefined();
    });

    // The identical route/channel mismatch on a GUARDED route still throws: a
    // guard on '/board/:id' could read pathParams.id, so the divergence is a
    // real hazard, not a benign route-independent room.
    it('still throws for the identical mismatch on a GUARDED param route', async () => {
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: { chat: { channel: { name: 'global-chat' } } },
        }),
      ];
      await expect(
        assertRouteBindingsMatchMount(routes, ctxOf([['/board/:id', [guard]]]))
      ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
    });

    // Same pairing through the registry path (explicit __routeId + a route
    // table entry with an empty vs. non-empty chain), for parity with the
    // module-mount path above.
    it('registry: does not throw for a guard-less param route', async () => {
      const roomMod = async () => ({
        serverRooms: {
          chat: { __routeId: '/board/:id', channel: { name: 'global-chat' } },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/board/:id', []]]),
        })
      ).resolves.toBeUndefined();
    });

    it('registry: still throws for a guarded param route', async () => {
      const roomMod = async () => ({
        serverRooms: {
          chat: { __routeId: '/board/:id', channel: { name: 'global-chat' } },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/board/:id', [guard]]]),
        })
      ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
    });
  });

  describe('P2-b: exemption requires ALL THREE guard tiers empty (round-4 fix)', () => {
    // Round-3's exemption only checked the PAGE-use chain
    // (ctx.routeUseByPattern.get(routeId)), but composeServerChain feeds the
    // SAME pathParams to all three tiers: [...appConfig.use, ...pageUse,
    // ...def.use]. An app-level or the room's own guard can read the missing
    // param just as readily as a page-level one, so the exemption must not
    // fire while either of those tiers is live.

    it('throws when page-use is empty but APP-use is non-empty (app tier live)', async () => {
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: { chat: { channel: { name: 'global-chat' } } },
        }),
      ];
      await expect(
        assertRouteBindingsMatchMount(routes, {
          routeUseByPattern: new Map([['/board/:id', []]]),
          appUse: [guard],
        })
      ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
    });

    it("throws when page-use is empty but the room's OWN use is non-empty (def tier live)", async () => {
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: {
            chat: { channel: { name: 'global-chat' }, use: [guard] },
          },
        }),
      ];
      await expect(
        assertRouteBindingsMatchMount(routes, ctxOf([['/board/:id', []]]))
      ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
    });

    it('does not throw when ALL THREE tiers are empty, and fires the exemption advisory', async () => {
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: { chat: { channel: { name: 'global-chat' } } },
        }),
      ];
      const seen: RoomParamExemptionInfo[] = [];
      await expect(
        assertRouteBindingsMatchMount(routes, {
          routeUseByPattern: new Map([['/board/:id', []]]),
          appUse: [],
          onRoomParamExemption: (info) => seen.push(info),
        })
      ).resolves.toBeUndefined();
      expect(seen).toEqual([
        {
          name: 'chat',
          routeId: '/board/:id',
          channelName: 'global-chat',
          params: ['id'],
        },
      ]);
    });
  });

  describe('P1-1: guard-readable namespace covers optional/rest route params (round-5 fix)', () => {
    // preact-iso's runtime matcher (`exec`) binds an optional or rest route
    // param over HTTP just as readily as a required one, and a guard reads
    // `ctx.location.pathParams` the same way regardless of the modifier.
    // Round-4's congruence check used ONLY `requiredParamSlots`, which
    // EXCLUDES optional ('?') and rest-zero-or-more ('*') slots, so a route
    // whose only params are optional/rest early-returned
    // (`routeParams.length === 0`) and skipped the check entirely -- even
    // though the channel key named a totally different param and a guard
    // could read the wrong (undefined) value. These pin the fix:
    // `declaredParamSlots` (which INCLUDES optional/rest) now drives the
    // early-return and the name-coverage condition.

    it('throws for an OPTIONAL route param (:id?) satisfied by a differently-named channel key, on a guarded route', async () => {
      const roomMod = async () => ({
        serverRooms: {
          cursors: {
            __routeId: '/board/:id?',
            channel: { name: 'board/:boardId' },
          },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/board/:id?', [guard]]]),
        })
      ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
    });

    it('throws for a REST route param (:rest*) satisfied by a differently-named channel key, on a guarded route', async () => {
      const roomMod = async () => ({
        serverRooms: {
          files: {
            __routeId: '/files/:rest*',
            channel: { name: 'files/:name' },
          },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/files/:rest*', [guard]]]),
        })
      ).rejects.toThrow(/route param .*rest.* is not a key of channel/i);
    });

    it('still throws when a REQUIRED route param is satisfied only by an OPTIONAL channel slot of the same name (presence guarantee)', async () => {
      // Names line up (`id`/`id`), so condition 1 (name coverage) passes.
      // But the channel only DECLARES `id` as optional, so it never
      // guarantees the value a required route param promises: condition 2
      // (presence guarantee) must still fire.
      const roomMod = async () => ({
        serverRooms: {
          cursors: {
            __routeId: '/board/:id',
            channel: { name: 'board/:id?' },
          },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/board/:id', [guard]]]),
        })
      ).rejects.toThrow(
        /route param .*id.* only an optional or rest key in channel/i
      );
    });

    it('does not throw when an optional route param is satisfied by a same-named optional channel slot', async () => {
      const roomMod = async () => ({
        serverRooms: {
          cursors: {
            __routeId: '/board/:id?',
            channel: { name: 'board/:id?' },
          },
        },
      });
      await expect(
        assertRegistryRouteBindingsValid([roomMod], {
          routeUseByPattern: new Map([['/board/:id?', [guard]]]),
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('P2: tier liveness counts only SERVER middleware', () => {
    // composeServerChain filters a tier to `m.runs === 'server'` before
    // running it, so a client-scope middleware (or a StreamObserver) in
    // appConfig.use/page-use/def.use can never read ctx.location.pathParams.
    // Counting raw array length would make an app-level logger or a
    // client-scope middleware hard-fail the boot of an otherwise-exempt
    // (guard-less) room.
    it('does not throw when the app tier contains ONLY a non-server (client-scope) middleware', async () => {
      const clientOnly = defineClientMiddleware(async (_c, next) => next());
      const routes = [
        routeOf('/board/:id', {
          __moduleKey: 'm',
          serverRooms: { chat: { channel: { name: 'global-chat' } } },
        }),
      ];
      const seen: RoomParamExemptionInfo[] = [];
      await expect(
        assertRouteBindingsMatchMount(routes, {
          routeUseByPattern: new Map([['/board/:id', []]]),
          appUse: [clientOnly],
          onRoomParamExemption: (info) => seen.push(info),
        })
      ).resolves.toBeUndefined();
      expect(seen).toEqual([
        {
          name: 'chat',
          routeId: '/board/:id',
          channelName: 'global-chat',
          params: ['id'],
        },
      ]);
    });
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

describe('warnRoomParamBinding', () => {
  it('warns once per binding key, naming the room, route, and params', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warned = new Set<string>();
      const info: RoomParamBindingInfo = {
        name: 'cursors',
        routeId: '/board/:id',
        params: ['id'],
      };
      warnRoomParamBinding(warned, info);
      warnRoomParamBinding(warned, info);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain("'cursors'");
      expect(msg).toContain("'/board/:id'");
      expect(msg).toContain('id');
      expect(msg).toContain('channel key');
    } finally {
      warn.mockRestore();
    }
  });

  it('warns again for a different binding key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warned = new Set<string>();
      warnRoomParamBinding(warned, {
        name: 'cursors',
        routeId: '/board/:id',
        params: ['id'],
      });
      warnRoomParamBinding(warned, {
        name: 'presence',
        routeId: '/board/:id',
        params: ['id'],
      });
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
