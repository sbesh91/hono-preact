import { exec } from 'preact-iso';

/**
 * Capture a concrete URL's route params against a pattern using preact-iso's
 * own `exec` matcher, so server-side param extraction agrees exactly with the
 * client router. Returns the captured params on a match, else null. In
 * non-exact mode a descendant path also matches (a `/*` fallback), so a unit
 * bound to `/a/:x` still yields `{ x }` when addressed from `/a/p/b/q`.
 *
 * preact-iso types `exec` as always returning a match whose params are `any`,
 * but at runtime it returns `undefined` on no match; the optional chain pins
 * the half we use to `Record<string, string>`.
 */
export function matchRouteParams(
  path: string,
  route: string,
  exact: boolean
): Record<string, string> | null {
  const direct = exec(path, route)?.pathParams;
  if (direct) return direct;
  if (!exact) {
    const nested = exec(path, route.replace(/\/+$/, '') + '/*')?.pathParams;
    if (nested) return nested;
  }
  return null;
}
