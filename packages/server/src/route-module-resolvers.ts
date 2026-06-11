import type { ServerRoute } from '@hono-preact/iso';
import { findBestPattern } from './route-pattern.js';

/**
 * Shared core of the page-layer resolver factories (`makePageUseResolvers`
 * and `makePageActionResolvers`). Owns the lazy build lifecycle and the
 * URL-path lookup:
 *
 * - Loads every distinct server thunk exactly once per build. A given
 *   thunk may appear as `server` on one ServerRoute and as an `ancestor`
 *   on descendants; calling it just once keeps module-init side effects
 *   (e.g. logging, registry insertion) idempotent.
 * - Caches the built result for the process lifetime. A failed build is
 *   not cached (the next call retries), so a transient import error does
 *   not permanently poison the resolver. When `dev` is true the cache is
 *   bypassed on every call so editing a `.server.*` file takes effect
 *   without restarting the server.
 * - `byPath` resolves a concrete URL path (params substituted) to the
 *   most specific matching route pattern (see `findBestPattern`) and
 *   returns that route's composed value, or undefined when no pattern
 *   matches.
 *
 * The strategy owns everything route-shape-specific: how to compose one
 * route's value from its ancestor modules plus its own module (ancestors
 * arrive outermost-first, matching the middleware dispatcher's
 * outer -> inner contract), and any side index it accumulates during the
 * build (`extra`, e.g. a moduleKey reverse map).
 */
export function makeRouteModuleResolvers<TMod, TComposed, TExtra>(
  serverRoutes: ReadonlyArray<ServerRoute>,
  options: { dev?: boolean },
  strategy: {
    createExtra: () => TExtra;
    compose: (
      route: ServerRoute,
      ancestorMods: ReadonlyArray<TMod>,
      selfMod: TMod,
      extra: TExtra
    ) => TComposed;
  }
): {
  byPath: (path: string) => Promise<TComposed | undefined>;
  built: () => Promise<{ byPathMap: Map<string, TComposed>; extra: TExtra }>;
} {
  const dev = options.dev ?? false;

  type Built = { byPathMap: Map<string, TComposed>; extra: TExtra };
  let buildPromise: Promise<Built> | null = null;

  const build = async (): Promise<Built> => {
    const thunkCache = new Map<() => Promise<unknown>, Promise<TMod>>();
    const load = (thunk: () => Promise<unknown>): Promise<TMod> => {
      let p = thunkCache.get(thunk);
      if (!p) {
        // Structural read of a user-defined module's exports (a sanctioned
        // cast boundary); the strategy narrows the fields it actually reads.
        p = thunk().then((mod) => mod as TMod);
        thunkCache.set(thunk, p);
      }
      return p;
    };

    const byPathMap = new Map<string, TComposed>();
    const extra = strategy.createExtra();

    await Promise.all(
      serverRoutes.map(async (route) => {
        const ancestorMods = await Promise.all(route.ancestors.map(load));
        const selfMod = await load(route.server);
        // Two ServerRoutes sharing the same path mean two `.server.*` files
        // claim the same route, a route-table error. The route validator is
        // the right place to surface that; here last write wins, matching
        // the pre-consolidation factories.
        byPathMap.set(
          route.path,
          strategy.compose(route, ancestorMods, selfMod, extra)
        );
      })
    );

    return { byPathMap, extra };
  };

  const built = (): Promise<Built> => {
    if (dev) {
      // In dev, always rebuild so edits to any `.server.*` file take
      // effect on the next request without restarting the process.
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
    built,
    async byPath(path: string) {
      const { byPathMap } = await built();
      const pattern = findBestPattern(byPathMap.keys(), path);
      return pattern === null ? undefined : byPathMap.get(pattern);
    },
  };
}
