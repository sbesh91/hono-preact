import type { AppConfig } from '@hono-preact/iso';
import { getDevGlobalCss } from './dev-global-css.js';
import { fontPreloadLinkHeader } from './font-preload.js';
import {
  resolvePreloadManifest,
  preloadLinkHeader,
} from './preload-modules.js';
import { selectRoutePreload } from './route-preload-match.js';

/**
 * The asset hints for one document render: what goes in the head as
 * `modulepreload`/stylesheet tags, and what goes in the `Link` response header.
 *
 * These are derived from the request URL, the app's font config, and the
 * process-global build artifacts installed at boot (the preload manifest and,
 * under `vite dev`, the dev global CSS seam). Nothing here depends on the
 * rendered HTML, the channel snapshot, or a loader's deny record, which is why
 * it can be resolved independently of the render itself.
 *
 * Note the install-time state: this is not a pure function of the URL, so it
 * must not be memoized per path across a manifest or dev-seam install.
 */
export interface AssetHints {
  /** The client entry's static-import closure. */
  preloadModules: string[];
  /** The matched route's own chunks, hinted at low priority. */
  routePreloadModules: string[];
  /** Render-critical stylesheets for the matched route. */
  routeStyleSheets: string[];
  /** Render-critical stylesheets that every route carries. */
  globalStyleSheets: string[];
  /**
   * The composed `Link` header value, or `''` when there is nothing to hint.
   * The caller appends it rather than setting it: a user's middleware may
   * already have written a `Link` header, and multiple `Link` headers are
   * valid (RFC 8288) and merged by the browser.
   */
  linkHeader: string;
}

/**
 * Decode the request path so it matches the build-time pattern keys, which are
 * decoded source-derived slugs (a `%20`/unicode segment would otherwise never
 * match). `decodeURI` keeps `/` intact (unlike `decodeURIComponent`) and can't
 * throw on valid input; fall back to the raw path on a malformed sequence.
 */
function decodeRoutePath(requestUrl: string): string {
  const routePath = new URL(requestUrl).pathname;
  try {
    return decodeURI(routePath);
  } catch {
    // keep the raw, encoded path
    return routePath;
  }
}

export async function resolveAssetHints(options: {
  requestUrl: string;
  fonts?: AppConfig['fonts'];
}): Promise<AssetHints> {
  // The client entry's static-import closure plus the matched route's own
  // chunks, hinted as `modulepreload` in the document head. Resolving is
  // memoized, so the platform reader runs at most once per isolate.
  const { closure, routes, routeCss, globalCss } =
    await resolvePreloadManifest();
  const routePath = decodeRoutePath(options.requestUrl);
  const routePreloadModules = selectRoutePreload(routes, routePath) ?? [];

  // The dev-global-css seam is installed only in serve mode (see
  // dev-global-css.ts), so its presence here IS "we are running under `vite
  // dev`". On the node adapter that matters beyond styling: a stale
  // dist/client from a previous build reads successfully in dev (the file on
  // disk didn't go anywhere when the dev server started), so the artifact's
  // hashed route/global stylesheet URLs would resolve to chunk names that
  // don't exist in this dev session and 404 render-blockingly. The dev-served
  // global stylesheet source already carries every rule those artifact sheets
  // would have carried (nothing is scoped away in dev), so artifact-driven
  // render-critical CSS is never wanted alongside it, not even as a
  // supplement. Modulepreload hints are left untouched: they're droppable (a
  // stale hint just 404s a prefetch, never the page).
  const devGlobalCss = getDevGlobalCss();
  const routeStyleSheets = devGlobalCss
    ? []
    : (selectRoutePreload(routeCss, routePath) ?? []);
  const globalStyleSheets = devGlobalCss ? [...devGlobalCss] : globalCss;

  // Only the entry closure goes in the `Link` header. The header is honored
  // before body parse, but it cannot carry `fetchpriority`, so a route chunk
  // placed there would preload at default priority and defeat the head tag's
  // `fetchpriority="low"`. The closure is the small, universal boot runtime
  // (worth the earliest hint); the route chunks are hinted low-priority via
  // the head tags only.
  // Fonts first (render-critical, higher-priority hint), then the boot
  // closure's modulepreload entries. The closure's truncation budget is
  // reduced by the font part's byte length so the two parts combined, not each
  // independently, stay within the header-size cap (the font part is never
  // truncated itself: fonts are few and small enough that it isn't worth the
  // complexity).
  const fontHeader = fontPreloadLinkHeader(options.fonts ?? []);
  const usedBytes = fontHeader ? fontHeader.length + 2 : 0;
  const linkHeader = [fontHeader, preloadLinkHeader(closure, usedBytes)]
    .filter(Boolean)
    .join(', ');

  return {
    preloadModules: closure,
    routePreloadModules,
    routeStyleSheets,
    globalStyleSheets,
    linkHeader,
  };
}
