import type { RoutesManifest, ServerRoute } from '@hono-preact/iso';

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

type PageUseModule = {
  __moduleKey?: unknown;
  pageUse?: unknown;
};

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
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
 * Score a route pattern for tiebreaker purposes when multiple patterns at
 * the same segment depth match the URL. Mirrors preact-iso's runtime
 * preference for literal segments: literal=2, param=1, wildcard=0. Within
 * the same score, the caller falls back to depth, and within the same
 * depth, to the loaded order in `serverRoutes`. Pre-merged literal wins
 * over `/admin/users/:id` when the URL is `/admin/users/me`.
 */
function patternScore(pattern: string): number {
  let score = 0;
  for (const seg of segmentsOf(pattern)) {
    if (seg === '*') score += 0;
    else if (seg.startsWith(':')) score += 1;
    else score += 2;
  }
  return score;
}

function pageUseFromMod(
  mod: PageUseModule,
  patternPath: string
): ReadonlyArray<unknown> {
  if (mod.pageUse === undefined || mod.pageUse === null) return [];
  if (Array.isArray(mod.pageUse)) return mod.pageUse as ReadonlyArray<unknown>;
  // Runtime guard for non-array pageUse: surface a descriptive error so
  // the user finds the typo (`pageUse = mySingleMw` instead of `[mySingleMw]`)
  // immediately rather than experiencing a silent gate failure. The
  // build-time plugin should catch this first; this is the runtime backstop.
  throw new Error(
    `Route '${patternPath}' exports a non-array \`pageUse\`. ` +
      `pageUse must be an array (typically a reference to a const declared as \`[mw1, mw2]\`). ` +
      `Wrap a single middleware in brackets: pageUse = [myMiddleware].`
  );
}

/**
 * Build the two page-layer `use` resolvers wired into loadersHandler and
 * pageActionHandler. The loader handler matches by the location's URL path;
 * the action handler matches by the action's owning module key. Both
 * lookups share one underlying composed map populated by loading every
 * routed `.server.*` module exactly once (then caching the result).
 *
 * Ancestor composition: each ServerRoute carries an explicit list of
 * ancestor server thunks captured during the route-tree walk. The
 * resolver loads each ancestor's `pageUse` (if any) and concatenates them
 * outer-first, with the route's own pageUse appended last. So a layout
 * group's pageUse runs before each nested leaf's pageUse without the user
 * having to repeat the import in every leaf .server.*. Order matches the
 * middleware dispatcher's outer -> inner contract: app -> outermost
 * layout -> ... -> leaf -> per-unit.
 *
 * Why route-tree ancestry (not URL-prefix ancestry): two routes can share
 * a URL prefix without being parent/child in the tree. For example,
 * `/demo/projects` and `/demo/projects/:projectId/issues/:issueId` are
 * siblings of the `/demo` layout group; the latter is NOT a descendant of
 * the former. URL-prefix matching incorrectly conflates them and runs the
 * shared gate twice on every nested request.
 *
 * Lazy semantics: the first call to either resolver triggers the build of
 * all server modules listed in `serverRoutes`. Subsequent calls return
 * from the cached map. A failed build is not cached -- the next call
 * retries -- so a transient import error doesn't permanently poison the
 * resolver. Modules that don't export `pageUse` (the common case today)
 * contribute nothing to the composed arrays. When `dev` is true the cache
 * is bypassed on every call so editing a `.server.*` file's `pageUse`
 * takes effect without restarting the server.
 *
 * NOTE: framework-private. The only intended consumer outside tests is
 * the generated server entry. Reach for it at your own risk.
 */
export function makePageUseResolvers(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean } = {}
): {
  byPath: (path: string) => Promise<ReadonlyArray<unknown>>;
  byModuleKey: (key: string) => Promise<ReadonlyArray<unknown>>;
} {
  const dev = options.dev ?? false;

  type Built = {
    composedByPath: Map<string, ReadonlyArray<unknown>>;
    patternByModuleKey: Map<string, string>;
  };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    // Load every distinct server thunk exactly once. A given thunk may
    // appear as `server` on one ServerRoute and as an `ancestor` on
    // descendants; calling it just once keeps module-init side effects
    // (e.g. logging, registry insertion) idempotent.
    const thunkCache = new Map<
      () => Promise<unknown>,
      Promise<PageUseModule>
    >();
    const load = (thunk: () => Promise<unknown>): Promise<PageUseModule> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        p = thunk().then((mod) => mod as PageUseModule);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const composedByPath = new Map<string, ReadonlyArray<unknown>>();
    const patternByModuleKey = new Map<string, string>();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(
          route.ancestors.map((t) => load(t))
        );
        const selfMod = await load(route.server);

        const composed: unknown[] = [];
        for (let i = 0; i < ancestorMods.length; i++) {
          composed.push(...pageUseFromMod(ancestorMods[i], route.path));
        }
        composed.push(...pageUseFromMod(selfMod, route.path));

        // Two ServerRoutes sharing the same path mean two `.server.*` files
        // claim the same route -- a route-table error. The route validator
        // is the right place to surface that; here we simply preserve the
        // load order (last write wins for the composed map, which matches
        // the previous behavior of `composedByPath.set(path, ...)`).
        composedByPath.set(route.path, composed);

        if (typeof selfMod.__moduleKey === 'string') {
          patternByModuleKey.set(selfMod.__moduleKey, route.path);
        }
      })
    );

    return { composedByPath, patternByModuleKey };
  };

  const get = () => {
    if (dev) {
      // In dev, always rebuild so edits to `pageUse` in any .server.* file
      // take effect on the next request without restarting the process.
      return build();
    }
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
      // best-matching pattern. Tiebreaker: (1) higher specificity score
      // (literal=2, param=1, wildcard=0); (2) within same score, longer
      // path; (3) within same length, first inserted. Mirrors preact-iso's
      // runtime preference for literal matches over parameterized siblings.
      //
      // NOTE: O(routes) linear scan. Fine for small apps; a precomputed
      // trie or a request-keyed memo would help at scale.
      let bestPattern: string | null = null;
      let bestScore = -1;
      let bestDepth = -1;
      for (const pattern of composedByPath.keys()) {
        if (!urlPathMatchesPattern(path, pattern)) continue;
        const score = patternScore(pattern);
        const depth = segmentsOf(pattern).length;
        if (score > bestScore || (score === bestScore && depth > bestDepth)) {
          bestPattern = pattern;
          bestScore = score;
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
