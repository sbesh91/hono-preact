import { useLocation, useRoute } from 'preact-iso';
import { matchRouteParams } from './internal/match-route.js';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

// Dedupe key is the route pattern: a mismatched `useParams` in a component
// that re-renders would otherwise warn on every render. Module-level, matching
// the `warned` set in page-actions-handler.ts.
const warnedRoutes = new Set<string>();

export function __resetParamsWarningsForTesting(): void {
  warnedRoutes.clear();
}

/**
 * Typed route params for the named route. `route` is a type-level selector that
 * names which route's param shape to project; the live param values come from
 * the active route match. Constrain to the registered route union once an app
 * adds the `declare module 'hono-preact'` registration; until then any string
 * is accepted and its param shape projected.
 *
 * ```tsx
 * const { projectId } = useParams('/demo/projects/:projectId');
 * ```
 *
 * The named route must be the active one. When it is not, the returned object
 * does not have the shape this projects, and dev builds warn. Reach for
 * `useRouteMatch(route)` when the route may legitimately not be active: it
 * returns the match or `null` rather than projecting a shape that is not there.
 *
 * Must be called under a `LocationProvider`, which the generated client
 * entry supplies.
 */
export function useParams<P extends RegisteredPaths>(route: P): RouteParams<P> {
  // useLocation, not useRouteMatch: the warning check below is dev-only, so
  // the match itself must stay dev-only too, or every render pays for
  // preact-iso's exec() in production for a check whose result is never
  // used. useLocation is the only hook here, so hook order is unaffected by
  // the dev gate.
  const { path } = useLocation();
  if (
    typeof import.meta.env === 'undefined' ||
    import.meta.env.SSR ||
    import.meta.env.DEV
  ) {
    // Non-exact: an ancestor route reading a descendant's active params (a
    // layout or nested leaf) is correct usage, not a mismatch. Only a path
    // that does not descend from `route` at all is worth warning about.
    //
    // `path` is falsy when there is no ancestor `LocationProvider` (preact-iso
    // defaults its context to `{}`), e.g. a page component unit-tested in
    // isolation. Skip the check rather than let `matchRouteParams` reach
    // `exec`'s `url.split('/')` on `undefined`: this warning is a dev aid,
    // not a hard requirement, so there is nothing useful to check without a
    // real path.
    const match = path ? matchRouteParams(path, route, false) : null;
    if (path && match === null && !warnedRoutes.has(route)) {
      console.warn(
        `hono-preact: useParams('${route}') was called where that route is ` +
          `not the active route, so the returned params do not have the ` +
          `shape it projects. Use useRouteMatch('${route}') when the route ` +
          `may not be active; it returns null instead of a mis-shaped object.`
      );
      warnedRoutes.add(route);
    }
  }
  // The structural read off Record<string, string> is the one sanctioned cast
  // boundary: the runtime value lacks the literal that `route` names.
  return useRoute().pathParams as RouteParams<P>;
}
