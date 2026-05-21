import type { RoutesManifest, ServerRoute } from '@hono-preact/iso';

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

type PageUseModule = {
  __moduleKey?: unknown;
  pageUse?: unknown;
};

/**
 * Build the two page-layer `use` resolvers wired into loadersHandler and
 * actionsHandler. The loader handler matches by the location path; the
 * action handler matches by the action's owning module key. Both lookups
 * share one underlying map populated by loading every routed `.server.*`
 * module exactly once (then caching the result).
 *
 * Lazy semantics: the first call to either resolver triggers the build of
 * all server modules listed in `serverRoutes`. Subsequent calls return
 * from the cached map. A failed build is not cached — the next call
 * retries — so a transient import error doesn't permanently poison the
 * resolver. Modules that don't export `pageUse` (the common case today)
 * contribute nothing to the map.
 *
 * The resolvers return `ReadonlyArray<unknown>` synchronously after the
 * first await. The handlers `await` the call regardless, so the cold-path
 * vs hot-path behavior is identical from their perspective.
 */
export function makePageUseResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>
): {
  byPath: (path: string) => Promise<ReadonlyArray<unknown>>;
  byModuleKey: (key: string) => Promise<ReadonlyArray<unknown>>;
} {
  let buildPromise: Promise<{
    byPath: Map<string, ReadonlyArray<unknown>>;
    byModuleKey: Map<string, ReadonlyArray<unknown>>;
  }> | null = null;

  const build = async () => {
    const byPath = new Map<string, ReadonlyArray<unknown>>();
    const byModuleKey = new Map<string, ReadonlyArray<unknown>>();
    for (const { path, server } of serverRoutes) {
      const mod = (await server()) as PageUseModule;
      const pageUse = Array.isArray(mod.pageUse)
        ? (mod.pageUse as ReadonlyArray<unknown>)
        : null;
      if (pageUse) {
        byPath.set(path, pageUse);
        if (typeof mod.__moduleKey === 'string') {
          byModuleKey.set(mod.__moduleKey, pageUse);
        }
      }
    }
    return { byPath, byModuleKey };
  };

  const get = () => {
    if (buildPromise) return buildPromise;
    buildPromise = build().catch((err) => {
      buildPromise = null;
      return Promise.reject(err);
    });
    return buildPromise;
  };

  return {
    async byPath(path: string) {
      const { byPath } = await get();
      return byPath.get(path) ?? [];
    },
    async byModuleKey(key: string) {
      const { byModuleKey } = await get();
      return byModuleKey.get(key) ?? [];
    },
  };
}
