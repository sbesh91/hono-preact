import { describe, expect, it } from 'vitest';
import {
  assertRouteBindingsMatchMount,
  assertRegistryRouteBindingsValid,
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

describe('assertRegistryRouteBindingsValid', () => {
  const registryOf = (mod: Record<string, unknown>) => [async () => mod];
  const patterns = new Set(['/reports', '/reports/:id']);

  it('passes for route-less registry modules (bare units)', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: async () => 'ok' },
      serverActions: { export: async () => 'ok' },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, patterns)
    ).resolves.toBeUndefined();
  });

  it('passes for an empty registry', async () => {
    await expect(
      assertRegistryRouteBindingsValid([], patterns)
    ).resolves.toBeUndefined();
  });

  it('passes when a route-bound unit targets a real route pattern', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: bound('/reports') },
      serverActions: { archive: bound('/reports/:id') },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, patterns)
    ).resolves.toBeUndefined();
  });

  it('throws when a route-bound loader targets a route not in the table', async () => {
    const registry = registryOf({
      __moduleKey: 'src/server/reports',
      serverLoaders: { totals: bound('/nope') },
    });
    await expect(
      assertRegistryRouteBindingsValid(registry, patterns)
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
      assertRegistryRouteBindingsValid(registry, patterns)
    ).rejects.toThrow(
      /Route-bound action 'archive'.*is not a route in your route table/s
    );
  });
});
