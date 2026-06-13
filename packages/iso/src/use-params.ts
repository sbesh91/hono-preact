import { useRoute } from 'preact-iso';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

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
 */
export function useParams<P extends RegisteredPaths>(route: P): RouteParams<P> {
  void route; // type-level only; the live params come from the route match.
  // The structural read off Record<string, string> is the one sanctioned cast
  // boundary: the runtime value lacks the literal that `route` names.
  return useRoute().pathParams as RouteParams<P>;
}
