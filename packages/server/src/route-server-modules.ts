import type { RoutesManifest } from '@hono-preact/iso';

/**
 * Convert a RoutesManifest into the array of lazy server-module loaders
 * that loadersHandler / actionsHandler accept. Previously returned a record
 * keyed by stringified integers; those keys were unused at the call site
 * (handlers iterate values only), so the array form is just the same data
 * without dead surface. Vite-style globs (`Record<string, ...>`) are still
 * accepted by the handlers directly; this helper is for the
 * routes-manifest-driven path used by the framework's generated server
 * entry.
 */
export function routeServerModules(
  manifest: RoutesManifest
): ReadonlyArray<() => Promise<unknown>> {
  return manifest.serverImports;
}
