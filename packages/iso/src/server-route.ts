import {
  defineLoader,
  type DefineLoaderOpts,
  type Loader,
  type LoaderRef,
} from './define-loader.js';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

export interface RouteServer<RouteId extends string> {
  /**
   * Define a loader for this server module's route. `ctx.location.pathParams`
   * is typed from the route's pattern, so no per-loader route id and no
   * `LoaderCtx<...>` annotation are needed.
   *
   * Returns a non-live `LoaderRef<T, false>` (single-value `.View` / `useData`).
   * A `live` layout subscription is route-agnostic, so author it with
   * `defineLoader(fn, { live: true })` rather than through a route binding.
   */
  loader<T>(
    fn: Loader<T, RouteParams<RouteId>>,
    opts?: Omit<DefineLoaderOpts<T>, 'live'>
  ): LoaderRef<T, false>;
}

/**
 * Bind a server module to its route once. `route.loader(fn)` then infers
 * `ctx.location.pathParams` from the route's pattern; the route id autocompletes
 * and validates against your registered routes.
 *
 * ```ts
 * const route = serverRoute('/movies/:id');
 * export const serverLoaders = {
 *   default: route.loader(async ({ location }) => getMovie(location.pathParams.id)),
 * };
 * ```
 *
 * This is opt-in sugar over `defineLoader(routeId, fn)` for the common
 * one-module-one-route case. The route id is type-level only (inert at runtime);
 * for route-agnostic or shared-across-routes loaders, use `defineLoader`
 * directly. The Vite `moduleKeyPlugin` recognizes `route.loader(...)` calls in
 * `serverLoaders` and threads the module key just as it does for `defineLoader`.
 */
export function serverRoute<const RouteId extends RegisteredPaths>(
  route: RouteId
): RouteServer<RouteId> {
  return {
    loader: (fn, opts) => defineLoader(route, fn, opts),
  };
}
