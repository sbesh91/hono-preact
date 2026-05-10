import type { RoutesManifest } from '@hono-preact/iso';

/**
 * Convert a RoutesManifest into the lazy-glob-shaped record that
 * loadersHandler/actionsHandler accept. Keys are stringified integers and
 * unused at the call site; the handlers iterate over `Object.values(...)`.
 */
export function routeServerModules(
  manifest: RoutesManifest
): Record<string, () => Promise<unknown>> {
  const out: Record<string, () => Promise<unknown>> = {};
  manifest.serverImports.forEach((fn, i) => {
    out[String(i)] = fn;
  });
  return out;
}
