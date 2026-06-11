import type { RoutesManifest, ServerRoute } from '@hono-preact/iso';
import { makeRouteModuleResolvers } from './route-module-resolvers.js';

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
 * routed `.server.*` module exactly once.
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
 * Build lifecycle (thunk dedup, evict-on-failure caching, dev rebuild)
 * and URL-path matching live in `makeRouteModuleResolvers`.
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
  const core = makeRouteModuleResolvers<
    PageUseModule,
    ReadonlyArray<unknown>,
    Map<string, string>
  >(serverRoutes, options, {
    createExtra: () => new Map<string, string>(),
    compose: (route, ancestorMods, selfMod, patternByModuleKey) => {
      const composed: unknown[] = [];
      for (const mod of ancestorMods) {
        composed.push(...pageUseFromMod(mod, route.path));
      }
      composed.push(...pageUseFromMod(selfMod, route.path));
      if (typeof selfMod.__moduleKey === 'string') {
        patternByModuleKey.set(selfMod.__moduleKey, route.path);
      }
      return composed;
    },
  });

  return {
    async byPath(path: string) {
      return (await core.byPath(path)) ?? [];
    },
    async byModuleKey(key: string) {
      const { byPathMap, extra } = await core.built();
      const pattern = extra.get(key);
      return pattern ? (byPathMap.get(pattern) ?? []) : [];
    },
  };
}
