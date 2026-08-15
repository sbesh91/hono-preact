import type { RouteHook } from 'preact-iso';
import type { AnyLoaderRef } from './define-loader.js';
import type { ServerRoute } from './define-routes.js';
import { matchPath } from './route-active.js';
import { prefetch } from './prefetch.js';

function parseHref(href: string): {
  path: string;
  searchParams: Record<string, string>;
} {
  const parsed = new URL(href, 'http://_');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const searchParams: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    searchParams[key] = value;
  });
  return { path, searchParams };
}

// Specificity for picking among overlapping matches (a `:param`/`*` catch-all
// can match the same href as a literal leaf). Literal segments rank highest,
// then `:param`, then `*`; the most specific server route is the one the
// router lands on, so its params are the ones the target loader reads.
function specificity(pattern: string): number {
  let score = 0;
  for (const seg of pattern.split('/')) {
    if (seg === '') continue;
    if (seg.includes('*')) score += 1;
    else if (seg.startsWith(':')) score += 2;
    else score += 3;
  }
  return score;
}

/**
 * Prefetch `refs` for the route `href` points at, resolving the route's params
 * from `routes` (the manifest) so callers do not repeat the route pattern. A
 * warm cache makes repeat calls a no-op (see `prefetch`). An href that matches
 * no manifest route is a best-effort no-op.
 *
 * The manifest is passed IN rather than read from context, so this stays a
 * plain function callable from anywhere: `<NavLink>` reaches it through a
 * dynamic `import()` from inside an event handler, where a hook cannot run.
 * `usePrefetch` is the hook-shaped wrapper over this for direct consumers.
 *
 * This module is the lazy boundary for the prefetch machinery. It statically
 * imports `prefetch.js` and therefore its loader-runner graph, so importing it
 * eagerly from an always-shipped module would put those bytes in every app that
 * renders a link. Reach it with a dynamic `import()` from any such module.
 */
export function prefetchFor(
  href: string,
  refs: AnyLoaderRef | ReadonlyArray<AnyLoaderRef>,
  routes: ReadonlyArray<ServerRoute>
): void {
  const { path, searchParams } = parseHref(href);
  let bestParams: Record<string, string> | null = null;
  let bestScore = -1;
  for (const route of routes) {
    const params = matchPath(path, route.path, true);
    if (!params) continue;
    const score = specificity(route.path);
    if (score > bestScore) {
      bestScore = score;
      bestParams = params;
    }
  }
  if (!bestParams) return; // off-manifest or outside Routes: best-effort no-op
  const location: RouteHook = { path, pathParams: bestParams, searchParams };
  const list = Array.isArray(refs) ? refs : [refs];
  for (const ref of list) void prefetch(ref, { location });
}
