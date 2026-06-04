import { useLocation, exec } from 'preact-iso';

export interface RouteMatchOptions {
  /** When false, also match descendant paths (segment-prefix). Default true. */
  exact?: boolean;
}

/**
 * preact-iso types `exec` as always returning a `MatchProps` whose captured
 * params are `any`, but at runtime it returns `undefined` on no match. This
 * helper pins the half we use to a precise type so callers stay cast-free.
 */
function execParams(
  path: string,
  route: string
): Record<string, string> | undefined {
  return exec(path, route)?.pathParams;
}

/**
 * Test `path` against a route pattern (same grammar as `<Route path>`).
 * Returns the captured params on a match, else null. In non-exact mode a
 * descendant path also matches (`/a` matches `/a/b`).
 */
export function matchPath(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  const direct = execParams(path, route);
  if (direct) return direct;
  if (!exact) {
    // Strip a trailing slash before appending `/*`. A route already ending in
    // `*` becomes e.g. `/files/*/*`, which never yields a false match because
    // `exec` requires at least one matched segment per `*`.
    const nested = execParams(path, route.replace(/\/+$/, '') + '/*');
    if (nested) return nested;
  }
  return null;
}

export function useRouteMatch(
  route: string,
  options?: RouteMatchOptions
): Record<string, string> | null {
  const { path } = useLocation();
  return matchPath(path, route, options?.exact ?? true);
}

export function useRouteActive(
  route: string,
  options?: RouteMatchOptions
): boolean {
  return useRouteMatch(route, options) !== null;
}
