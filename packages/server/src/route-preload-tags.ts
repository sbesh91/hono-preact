// The matched route's own client chunks, surfaced to the SSR document as
// `modulepreload` hints. A route `view`/`layout` is a dynamic `import()` thunk,
// so the browser can't discover the route's chunk until it has downloaded and
// parsed the client entry and the router has matched the URL -- a late "route
// wave" after the entry closure (see issue #249; #250 flattened the entry
// closure, this flattens the active route's chunk).
//
// The build emits a pattern -> chunks map (vite `route-preload.ts`); this module
// matches the request path against it with the same `findBestPattern` the route
// manifest uses for params, and renders the tags. Preload is an optimization,
// never correctness: an absent map, no match, or an unknown route all degrade
// to today's no-hint behavior.

import { findBestPattern } from './route-pattern.js';

/**
 * Build-generated map from route pattern to the client chunk URLs that route
 * needs, split by fetch priority. Emitted into the client build artifact by the
 * vite preload plugin and read at runtime via the adapter's manifest reader.
 *
 * Keys are route patterns (e.g. `/`, `/docs/:slug`, `/docs/quick-start`),
 * matched against the request path with `findBestPattern`. Values are absolute,
 * root-relative hrefs (e.g. `/static/home-CB6FkG2E.js`):
 * - `high`: layout-chain chunks. They gate the hydration shell, so they keep
 *   modulepreload's default (High) priority.
 * - `low`: the leaf view/content chunk(s). The page content is already in the
 *   SSR HTML, so these are hinted with `fetchpriority="low"` to avoid contending
 *   with render-critical resources (CSS, fonts, the entry) for early bandwidth.
 */
export type RoutePreloadMap = Record<
  string,
  { high: readonly string[]; low: readonly string[] }
>;

// Minimal attribute escape. The hrefs are framework-generated chunk paths, not
// user input, but escaping keeps the emitted tag well-formed if a chunk name
// ever contains a reserved character.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The chunk hrefs for the route best matching `urlPath`, or `undefined` when
 * there is no map, no match, or the matched pattern carries no chunks. Split by
 * priority so both the head tags and the `Link` header can consume it.
 */
export function selectRoutePreload(
  map: RoutePreloadMap | undefined,
  urlPath: string
): { high: readonly string[]; low: readonly string[] } | undefined {
  if (!map) return undefined;
  // Prefer an exact literal-pattern match: it is unambiguously the best match
  // for this path, and it sidesteps a findBestPattern tie where a bare catch-all
  // `*` (depth 1) would otherwise outrank the empty-path `/` (depth 0) they both
  // score 0. So the home route `/` picks its own chunk, not the not-found route.
  const pattern = Object.hasOwn(map, urlPath)
    ? urlPath
    : findBestPattern(Object.keys(map), urlPath);
  if (!pattern) return undefined;
  const entry = map[pattern];
  if (!entry) return undefined;
  const { high = [], low = [] } = entry;
  if (high.length === 0 && low.length === 0) return undefined;
  return { high, low };
}

/**
 * `<link rel="modulepreload">` tags for the chunks the matched route needs, so
 * the browser fetches the route's layout/view chunks in parallel with the
 * client entry instead of discovering them several hops into the module graph.
 * Returns '' when there is nothing to preload, so the head injection degrades to
 * current behavior.
 *
 * `crossorigin` is required: module scripts are fetched in CORS mode, and a
 * `modulepreload` without it would prime a second, separately-keyed request.
 */
export function routePreloadTags(
  map: RoutePreloadMap | undefined,
  urlPath: string
): string {
  const selected = selectRoutePreload(map, urlPath);
  if (!selected) return '';
  const tags = [
    ...selected.high.map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttr(href)}" crossorigin />`
    ),
    ...selected.low.map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttr(href)}" crossorigin fetchpriority="low" />`
    ),
  ];
  return tags.join('\n        ');
}
