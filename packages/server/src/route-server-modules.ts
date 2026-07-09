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
 * synchronous map read.
 *
 * - `byPattern(pattern)`: resolve an EXACT route-pattern key directly (no
 *   matching). Every consumer (loaders RPC, action POST, socket upgrade) knows
 *   the unit's declared route pattern (`ref.__routeId` / `route.path`) and must
 *   NOT fuzzy-match a URL to it: a URL fed through a best-pattern matcher can
 *   collide with a sibling same-shaped pattern (`/a/:x` vs `/a/:y`) and return
 *   the wrong page's guards. There is deliberately no `byPath` (URL fuzzy-match)
 *   mode: it was the mechanism behind a bare-action guard-selection footgun and
 *   has no remaining safe consumer.
 *
 * NOTE: framework-private. The only intended consumer is the generated server
 * entry.
 */
export function makePageUseResolver(manifest: RoutesManifest): {
  byPattern: (pattern: string) => ReadonlyArray<unknown>;
} {
  const map = new Map(manifest.routeUse.map((r) => [r.path, r.use]));
  return {
    byPattern(pattern: string) {
      return map.get(pattern) ?? [];
    },
  };
}

/**
 * Build a dev-diagnostic matcher over the manifest's `routeUse`: given a
 * concrete URL path, return the best-matching route pattern when that
 * pattern's folded `use` chain is non-empty, else null. loadersHandler uses
 * it to warn (dev only) when a bare (route-independent) loader serves a
 * request under a guarded route, since the bare loader's RPC runs none of
 * that route's guards.
 *
 * Purely observational: the result never feeds guard resolution, so the URL
 * fuzzy-match that is forbidden for `makePageUseResolver` (see its note on
 * the byPath footgun) is safe here. A wrong best-match costs at most a
 * console hint.
 *
 * NOTE: framework-private. The only intended consumer is the generated
 * server entry.
 */
export function makeGuardedRouteMatcher(
  routeUse: ReadonlyArray<{ path: string; use: ReadonlyArray<unknown> }>
): (urlPath: string) => string | null {
  const useByPattern = new Map(routeUse.map((r) => [r.path, r.use]));
  return (urlPath) => {
    const best = findBestPattern(useByPattern.keys(), urlPath);
    if (best === null) return null;
    const use = useByPattern.get(best);
    return use !== undefined && use.length > 0 ? best : null;
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
