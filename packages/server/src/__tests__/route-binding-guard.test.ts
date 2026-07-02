import { describe, expect, it } from 'vitest';
import {
  assertRouteBindingsMatchMount,
  assertNoRouteBoundRegistryUnits,
} from '../route-binding-guard.js';
import type { ServerRoute } from '@hono-preact/iso';

// A route-bound export carries a non-enumerable `__routeId`; mirror that here.
const bound = (routeId: string, fn: () => unknown = async () => 'ok') =>
  Object.defineProperty(fn, '__routeId', { value: routeId, enumerable: false });

const routeOf = (path: string, mod: Record<string, unknown>): ServerRoute =>
  ({ path, ancestors: [], server: async () => mod }) as unknown as ServerRoute;

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
      assertRouteBindingsMatchMount(routes)
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
      assertRouteBindingsMatchMount(routes)
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
    await expect(assertRouteBindingsMatchMount(routes)).rejects.toThrow(
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
    await expect(assertRouteBindingsMatchMount(routes)).rejects.toThrow(
      /Route-bound loader 'default' is bound to route '\/somewhere\/else'/
    );
  });

  it('ignores modules with no server units', async () => {
    const routes = [routeOf('/x', { __moduleKey: 'm' })];
    await expect(
      assertRouteBindingsMatchMount(routes)
    ).resolves.toBeUndefined();
  });
});

describe('assertNoRouteBoundRegistryUnits', () => {
  const registryOf = (mod: Record<string, unknown>) => [async () => mod];

  it('passes for route-less registry modules (bare units)', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: async () => 'ok' },
      serverActions: { export: async () => 'ok' },
    });
    await expect(
      assertNoRouteBoundRegistryUnits(registry)
    ).resolves.toBeUndefined();
  });

  it('passes for an empty registry', async () => {
    await expect(assertNoRouteBoundRegistryUnits([])).resolves.toBeUndefined();
  });

  it('throws when a registry module has a route-bound loader', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: bound('/reports') },
    });
    await expect(assertNoRouteBoundRegistryUnits(registry)).rejects.toThrow(
      /Route-bound loader 'totals' \(serverRoute\('\/reports'\)\) lives in the src\/server registry/
    );
  });

  it('throws when a registry module has a route-bound action', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverActions: { archive: bound('/reports/:id') },
    });
    await expect(assertNoRouteBoundRegistryUnits(registry)).rejects.toThrow(
      /Route-bound action 'archive'.*supports route-less units only/s
    );
  });
});
