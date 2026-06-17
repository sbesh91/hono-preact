import { findBestPattern } from './route-pattern.js';

/**
 * Build-generated map from route pattern to the client chunk URLs the route
 * needs (its matched layout + view chunks and their transitive static
 * imports, with the client entry's own closure subtracted). Emitted by the
 * vite plugin's route-preload generator and threaded into `renderPage`.
 *
 * Keys are route patterns (e.g. `/docs/:slug`, `/docs/quick-start`) matched
 * against the request path with `findBestPattern`. Values are absolute,
 * origin-relative hrefs (e.g. `/static/quick-start-BH8CGeNi.js`).
 */
export type RoutePreloadMap = Record<string, readonly string[]>;

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
 * Emit `<link rel="modulepreload">` tags for the chunks the matched route
 * needs, so the browser fetches the route's layout/view chunks in parallel
 * with the client entry instead of discovering them several hops into the
 * module graph. Returns '' when there is no map, no match, or no chunks (so
 * the head injection degrades to current behavior).
 *
 * `crossorigin` is required: module scripts are fetched in CORS mode, and a
 * modulepreload without it would prime a second, separately-keyed request.
 */
export function routePreloadTags(
  map: RoutePreloadMap | undefined,
  urlPath: string
): string {
  if (!map) return '';
  const pattern = findBestPattern(Object.keys(map), urlPath);
  if (!pattern) return '';
  const hrefs = map[pattern];
  if (!hrefs || hrefs.length === 0) return '';
  return hrefs
    .map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttr(href)}" crossorigin />`
    )
    .join('\n        ');
}
