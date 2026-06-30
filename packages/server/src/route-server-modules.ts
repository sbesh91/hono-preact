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
 * `use` per pattern is static tree data (`manifest.routeUse`), so lookup is a
 * synchronous map read. Two lookup modes:
 *
 * - `byPath(url)`: resolve a CONCRETE URL (params substituted) to the most
 *   specific matching pattern and return its `use`. Used by the page-actions /
 *   SSR paths, which carry a real request URL.
 * - `byPattern(pattern)`: resolve an EXACT route-pattern key directly (no
 *   matching). Used by the loaders RPC path, which already knows the loader's
 *   declared route pattern (`ref.__routeId`) and must NOT fuzzy-match it: a
 *   pattern fed through `byPath` can collide with a sibling same-shaped pattern
 *   (`/a/:x` vs `/a/:y`) and return the wrong page's guards.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry.
 */
export function makePageUseResolver(manifest: RoutesManifest): {
  byPath: (path: string) => ReadonlyArray<unknown>;
  byPattern: (pattern: string) => ReadonlyArray<unknown>;
} {
  const map = new Map(manifest.routeUse.map((r) => [r.path, r.use]));
  return {
    byPath(path: string) {
      const pattern = findBestPattern(map.keys(), path);
      // Fails open (no `use` chain) when nothing matches. This is safe because
      // `map` is keyed by the COMPILE-TIME `manifest.routeUse`, so an unmatched
      // path means a request URL for which no page route was registered at all
      // -- there is no page (and so no page-tier guard) to drop. The two callers
      // both add their own gate: the loaders RPC uses `byPattern` (an exact key
      // lookup, never this fuzzy match), and the page-actions handler verifies
      // the action exists on the resolved route before it runs. A real route
      // always resolves to its own `use` here; only a no-such-page URL gets [].
      return pattern === null ? [] : (map.get(pattern) ?? []);
    },
    byPattern(pattern: string) {
      return map.get(pattern) ?? [];
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
