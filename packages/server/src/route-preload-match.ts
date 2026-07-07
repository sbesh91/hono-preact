// Match the request path to the matched route's own client chunks. A route
// `view`/`layout` is a dynamic `import()` thunk, so the browser can't discover
// the route's chunk until it has downloaded and parsed the client entry and the
// router has matched the URL -- a late "route wave" after the entry closure (see
// issue #249; #250 flattened the entry closure, this flattens the active route's
// chunk).
//
// The build emits a pattern -> chunks map (vite `route-preload.ts`); this module
// only does the matching (rendering + escaping of the `modulepreload` tags lives
// in document-shell.ts, which owns that for every framework-injected hint).
// Preload is an optimization, never correctness: an absent map, no match, or an
// unknown route all degrade to today's no-hint behavior.

import { findBestPattern } from './route-pattern.js';

/**
 * Build-generated map from route pattern to the client chunk URLs that route
 * needs, in discovery order (outer layout chunks first, leaf view last).
 * Emitted into the client build artifact by the vite preload plugin and read at
 * runtime via the adapter's manifest reader.
 *
 * Keys are route patterns (`/`, `/docs/:slug`, `/docs/quick-start`), matched
 * against the request path with `findBestPattern`. Values are absolute,
 * root-relative hrefs (`/static/home-CB6FkG2E.js`). A flat list, not a priority
 * split: like the entry closure, every route chunk is hydration-only and is
 * hinted at `fetchpriority="low"` so it yields to render-critical CSS/fonts.
 */
export type RoutePreloadMap = Record<string, string[]>;

/**
 * The chunk hrefs for the route best matching `urlPath`, or `undefined` when
 * there is no map, no match, or the matched pattern carries no chunks.
 */
export function selectRoutePreload(
  map: RoutePreloadMap | undefined,
  urlPath: string
): string[] | undefined {
  if (!map) return undefined;
  // Prefer an exact literal-pattern match: it is unambiguously the best match
  // for this path, and it sidesteps a findBestPattern tie where a bare catch-all
  // `*` (depth 1) would otherwise outrank the empty-path `/` (depth 0) they both
  // score 0. So the home route `/` picks its own chunk, not the not-found route.
  const pattern = Object.hasOwn(map, urlPath)
    ? urlPath
    : findBestPattern(Object.keys(map), urlPath);
  if (!pattern) return undefined;
  const chunks = map[pattern];
  return chunks && chunks.length > 0 ? chunks : undefined;
}
