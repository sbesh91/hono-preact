import { findBestPattern } from './route-pattern.js';

/**
 * Build-generated map from route pattern to the client chunk URLs the route
 * needs, split by fetch priority. Emitted by the vite plugin's route-preload
 * generator and threaded into `renderPage`.
 *
 * Keys are route patterns (e.g. `/docs/:slug`, `/docs/quick-start`) matched
 * against the request path with `findBestPattern`. Values are absolute,
 * origin-relative hrefs (e.g. `/static/quick-start-BH8CGeNi.js`):
 * - `high`: layout-chain chunks, emitted at modulepreload's default priority.
 * - `low`: leaf view/content chunks, emitted with `fetchpriority="low"` since
 *   the content is already server-rendered and should not contend with
 *   render-critical resources for bandwidth.
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
  const entry = map[pattern];
  if (!entry) return '';
  const { high = [], low = [] } = entry;
  if (high.length === 0 && low.length === 0) return '';
  const tags = [
    ...high.map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttr(href)}" crossorigin />`
    ),
    ...low.map(
      (href) =>
        `<link rel="modulepreload" href="${escapeAttr(href)}" crossorigin fetchpriority="low" />`
    ),
  ];
  return tags.join('\n        ');
}
