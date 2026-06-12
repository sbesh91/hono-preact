import { useCallback, useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from './define-loader.js';
import { prefetch } from './prefetch.js';
import { matchPath } from './route-active.js';
import { RouteManifestContext } from './internal/route-manifest.js';

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
 * Returns a callback that prefetches `refs` for the route `href` points at.
 * Bind it to any intent event (hover, focus, touch, pointerenter, an
 * IntersectionObserver). The route's params are resolved from the manifest, so
 * callers do not repeat the route pattern. A warm cache makes repeat calls a
 * no-op (see `prefetch`).
 */
export function usePrefetch(
  href: string,
  refs: LoaderRef<unknown> | ReadonlyArray<LoaderRef<unknown>>
): () => void {
  const routes = useContext(RouteManifestContext);
  return useCallback(() => {
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
  }, [href, refs, routes]);
}
