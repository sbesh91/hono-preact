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
