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

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/**
 * True when `prefix` is the same route as or an ancestor of `descendant`,
 * comparing pattern segment by pattern segment. Literal segments must match
 * exactly; two `:param` segments at the same position are treated as
 * structurally equivalent (real route trees re-use parent param names);
 * a `*` segment in `prefix` matches everything beyond it.
 *
 * Used at build time to compose each route's pageUse with every ancestor
 * .server.* module's pageUse.
 */
function patternIsAncestor(prefix: string, descendant: string): boolean {
  const ps = segmentsOf(prefix);
  const ds = segmentsOf(descendant);
  if (ps.length > ds.length) return false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const d = ds[i];
    if (p === '*') return true;
    if (p === d) continue;
    if (p.startsWith(':') && d.startsWith(':')) continue;
    return false;
  }
  return true;
}

/**
 * True when `urlPath` (the concrete URL the user navigated to, with all
 * params substituted) matches `pattern` exactly: same segment count, and
 * each pattern segment either equals the URL segment, is a `:param`, or is
 * a trailing `*`.
 *
 * Used at lookup time. `byPath` resolves the URL to the most specific
 * pattern in the map and returns its already-composed pageUse.
 */
function urlPathMatchesPattern(urlPath: string, pattern: string): boolean {
  const ps = segmentsOf(pattern);
  const us = segmentsOf(urlPath);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p === '*') return true;
    if (i >= us.length) return false;
    if (p.startsWith(':')) continue;
    if (p !== us[i]) return false;
  }
  return ps.length === us.length;
}

/**
 * Build the two page-layer `use` resolvers wired into loadersHandler and
 * actionsHandler. The loader handler matches by the location's URL path;
 * the action handler matches by the action's owning module key. Both
 * lookups share one underlying composed map populated by loading every
 * routed `.server.*` module exactly once (then caching the result).
 *
 * Ancestor composition: the value for each route is `pageUse` concatenated
 * across every server-bearing ancestor in the route tree, outermost first,
 * with the route's own pageUse appended last. So a layout group's pageUse
 * runs before each nested leaf's pageUse without the user having to repeat
 * the import in every leaf .server.*. Order matches the middleware
 * dispatcher's outer -> inner contract: app -> outermost layout -> ...
 * -> leaf -> per-unit.
 *
 * Lazy semantics: the first call to either resolver triggers the build of
 * all server modules listed in `serverRoutes`. Subsequent calls return
 * from the cached map. A failed build is not cached -- the next call
 * retries -- so a transient import error doesn't permanently poison the
 * resolver. Modules that don't export `pageUse` (the common case today)
 * contribute nothing to the composed arrays.
 */
export function makePageUseResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>
): {
  byPath: (path: string) => Promise<ReadonlyArray<unknown>>;
  byModuleKey: (key: string) => Promise<ReadonlyArray<unknown>>;
} {
  type LoadedEntry = {
    patternPath: string;
    moduleKey: string | null;
    pageUse: ReadonlyArray<unknown> | null;
  };
  type Built = {
    composedByPath: Map<string, ReadonlyArray<unknown>>;
    patternByModuleKey: Map<string, string>;
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const loaded: LoadedEntry[] = await Promise.all(
      serverRoutes.map(async ({ path, server }) => {
        const mod = (await server()) as PageUseModule;
        return {
          patternPath: path,
          moduleKey:
            typeof mod.__moduleKey === 'string' ? mod.__moduleKey : null,
          pageUse: Array.isArray(mod.pageUse)
            ? (mod.pageUse as ReadonlyArray<unknown>)
            : null,
        };
      })
    );

    const composedByPath = new Map<string, ReadonlyArray<unknown>>();
    const patternByModuleKey = new Map<string, string>();
    for (const entry of loaded) {
      const ancestors = loaded
        .filter((other) =>
          patternIsAncestor(other.patternPath, entry.patternPath)
        )
        // Outer-first ordering by segment count. Two ancestors at the same
        // depth would mean two .server.* files claim the same route, which
        // is a route-table error; preserve their loaded order in that case
        // and let the route validator surface it elsewhere.
        .sort(
          (a, b) =>
            segmentsOf(a.patternPath).length - segmentsOf(b.patternPath).length
        );
      const composed = ancestors.flatMap((a) => a.pageUse ?? []);
      composedByPath.set(entry.patternPath, composed);
      if (entry.moduleKey) {
        patternByModuleKey.set(entry.moduleKey, entry.patternPath);
      }
    }
    return { composedByPath, patternByModuleKey };
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
      const { composedByPath } = await get();
      // The handler receives the matched route's URL path (params
      // substituted to literal values). Walk the composed map and pick the
      // most specific pattern whose segments align with the URL. The
      // composed value already includes ancestor pageUse, so a single
      // lookup is enough -- no concat at request time.
      let bestPattern: string | null = null;
      let bestDepth = -1;
      for (const pattern of composedByPath.keys()) {
        if (!urlPathMatchesPattern(path, pattern)) continue;
        const depth = segmentsOf(pattern).length;
        if (depth > bestDepth) {
          bestPattern = pattern;
          bestDepth = depth;
        }
      }
      return bestPattern ? (composedByPath.get(bestPattern) ?? []) : [];
    },
    async byModuleKey(key: string) {
      const { composedByPath, patternByModuleKey } = await get();
      const pattern = patternByModuleKey.get(key);
      return pattern ? (composedByPath.get(pattern) ?? []) : [];
    },
  };
}
