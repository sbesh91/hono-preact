import type { RoutesManifest } from '@hono-preact/iso';
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
