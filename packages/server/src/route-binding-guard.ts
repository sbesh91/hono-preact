import type { ServerRoute } from '@hono-preact/iso';

/**
 * A route-bound loader/action stamps its declared route pattern onto the export
 * as a non-enumerable `__routeId` (`serverRoute(r).loader` / `.action`). Read it
 * structurally; bare units leave it `undefined`.
 */
type RouteBoundExport = { __routeId?: unknown };
type SelfModule = {
  serverLoaders?: unknown;
  serverActions?: unknown;
};

const CONTAINERS = [
  ['serverLoaders', 'loader'],
  ['serverActions', 'action'],
] as const;

function readExports(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Fail closed at boot if any route-bound loader/action declares a route other
 * than the one its module is registered on.
 *
 * A route-bound unit resolves its page-level `use` (auth) chain by its declared
 * `__routeId` pattern (`makePageUseResolver.byPattern`), NOT by the request URL.
 * That lookup fails OPEN on a key miss, and a routeId that points at a different
 * route resolves that route's gates. Either way a misbound unit can run under a
 * weaker (or empty) gate chain than the route it is actually reachable from. The
 * binding is only correct when `__routeId` equals the path of the route node the
 * module is mounted on (`route.path`), which is also the invariant `byPattern`
 * relies on to resolve a real `routeUse` entry. We assert it once here so a
 * misconfiguration surfaces as a loud startup error instead of a silently
 * dropped auth gate at request time.
 *
 * Bare units (no `__routeId`) are skipped: they resolve page-use by request URL
 * and carry no binding to check.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry, which awaits this before serving the loaders RPC and action POST paths.
 */
export async function assertRouteBindingsMatchMount(
  serverRoutes: ReadonlyArray<ServerRoute>
): Promise<void> {
  await Promise.all(
    serverRoutes.map(async (route) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await route.server()) as SelfModule;
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId === 'string' && routeId !== route.path) {
            throw new Error(
              `Route-bound ${kind} '${name}' is bound to route '${routeId}', but its ` +
                `module is registered on route '${route.path}'. A route-bound ${kind} must ` +
                `use serverRoute('${route.path}') to match the route it is mounted on; ` +
                `otherwise it resolves its page-level \`use\` (auth) chain from the wrong ` +
                `route. Bind it to '${route.path}', or move the module to '${routeId}'.`
            );
          }
        }
      }
    })
  );
}

/**
 * Fail closed at boot if a `src/server` registry module has a route-bound
 * (`serverRoute(r).loader` / `.action`) unit whose route is not real.
 *
 * A registry module is not attached to a route node, so a route-bound unit in
 * it resolves its page-level `use` (auth) chain by `byPattern(__routeId)`. That
 * lookup fails OPEN (empty chain) on a miss, so a `__routeId` that does not name
 * a real route pattern would run the unit under NO gates. `routeUse` carries an
 * entry for every matchable route (see iso `collectRouteUse`), so we require the
 * `__routeId` to be one of those patterns; a real route always resolves its
 * composed gate chain, and a typo / stale pattern fails loudly here instead of
 * silently dropping auth at request time.
 *
 * Bare units (no `__routeId`) are route-less and skipped; they resolve page-use
 * by request URL.
 *
 * NOTE: framework-private. Consumed by the generated server entry alongside
 * {@link assertRouteBindingsMatchMount}.
 */
export async function assertRegistryRouteBindingsValid(
  registry: ReadonlyArray<() => Promise<unknown>>,
  validRoutePatterns: ReadonlySet<string>
): Promise<void> {
  await Promise.all(
    registry.map(async (load) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await load()) as SelfModule;
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId === 'string' && !validRoutePatterns.has(routeId)) {
            throw new Error(
              `Route-bound ${kind} '${name}' in the src/server registry is bound to ` +
                `route '${routeId}', which is not a route in your route table. A ` +
                `serverRoute('${routeId}') unit must target a real route pattern so it ` +
                `resolves that route's page-level \`use\` (auth) chain; otherwise it would ` +
                `run under no gates. Fix the pattern to match a route in routes.ts (an ` +
                `exact pattern, e.g. '/movies/:id'), or move the unit to that route's module.`
            );
          }
        }
      }
    })
  );
}
