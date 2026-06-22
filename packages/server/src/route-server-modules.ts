import type { RoutesManifest, ServerRoute } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

/**
 * Convert a RoutesManifest into the array of lazy server-module loaders
 * that loadersHandler accepts. Previously returned a record keyed by
 * stringified integers; those keys were unused at the call site (handlers
 * iterate values only), so the array form is just the same data without dead
 * surface. Vite-style globs (`Record<string, ...>`) are still accepted by
 * loadersHandler directly; this helper is for the routes-manifest-driven
 * path used by the framework's generated server entry.
 */
export function routeServerModules(
  manifest: RoutesManifest
): ReadonlyArray<() => Promise<unknown>> {
  return manifest.serverImports;
}

/**
 * Build the page-layer `use` resolver from the route manifest. The composed
 * `use` per pattern is static tree data (`manifest.routeUse`), so this is a
 * synchronous lookup: match the request URL to the most specific pattern and
 * return its array (empty when nothing matches or the route is unguarded).
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry.
 */
export function makePageUseResolver(manifest: RoutesManifest): {
  byPath: (path: string) => ReadonlyArray<unknown>;
} {
  const map = new Map(manifest.routeUse.map((r) => [r.path, r.use]));
  return {
    byPath(path: string) {
      const pattern = findBestPattern(map.keys(), path);
      return pattern === null ? [] : (map.get(pattern) ?? []);
    },
  };
}

type ServerModuleWithKey = {
  __moduleKey?: unknown;
  [key: string]: unknown;
};

/**
 * Build a resolver from socket moduleKey to the owning route's path. Used by
 * `socketsHandler` to derive the route path server-side (not from the client)
 * so that `resolvePageUse` receives the correct path for route-node `use`
 * inheritance.
 *
 * Walks `serverRoutes`, loads each route's `.server` module, reads
 * `__moduleKey`, and maps it to `route.path`. Mirrors the pattern in
 * `makePageActionResolvers` (page-action-resolvers.ts). Returns a promise so
 * the caller can await the async module loads once and cache the result.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry via `socketsHandler`.
 */
export async function makeSocketRoutePathResolver(
  serverRoutes: ReadonlyArray<ServerRoute>
): Promise<{ byModuleKey: (moduleKey: string) => string | undefined }> {
  const map = new Map<string, string>();
  await Promise.all(
    serverRoutes.map(async (route) => {
      // Structural read of a user-defined module's exports (a sanctioned
      // cast boundary); only __moduleKey is read.
      const mod = (await route.server()) as ServerModuleWithKey;
      const moduleKey = mod.__moduleKey;
      if (typeof moduleKey === 'string') {
        map.set(moduleKey, route.path);
      }
    })
  );
  return {
    byModuleKey(moduleKey: string): string | undefined {
      return map.get(moduleKey);
    },
  };
}
