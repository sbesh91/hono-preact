import { useLocation } from 'preact-iso';
import { matchRouteParams } from './internal/match-route.js';
import type { RouteParams, RoutePattern } from './internal/typed-routes.js';

export interface RouteMatchOptions {
  /** When false, also match descendant paths (segment-prefix). Default true. */
  exact?: boolean;
}

/**
 * Test `path` against a route pattern (same grammar as `<Route path>`).
 * Returns the captured params on a match, else null. In non-exact mode a
 * descendant path also matches (`/a` matches `/a/b`). Delegates to the shared
 * `matchRouteParams` so client and server capture params identically.
 */
export function matchPath(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  return matchRouteParams(path, route, exact);
}

export function useRouteMatch<R extends RoutePattern>(
  route: R,
  options?: RouteMatchOptions
): RouteParams<R> | null {
  const { path } = useLocation();
  return matchPath(
    path,
    route,
    options?.exact ?? true
  ) as RouteParams<R> | null;
}

export function useRouteActive(
  route: RoutePattern,
  options?: RouteMatchOptions
): boolean {
  return useRouteMatch(route, options) !== null;
}
