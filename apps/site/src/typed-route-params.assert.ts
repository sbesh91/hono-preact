// Compile-time assertions for the typed-route-params engine, exercised against
// the real site route tree. Not imported anywhere; `pnpm typecheck` is the
// oracle. If the type engine or the route registration regresses, tsc fails.
import {
  useParams,
  useRouteMatch,
  useRouteActive,
  buildPath,
} from 'hono-preact';
import type { RoutePaths, RouteParams, NavLinkProps } from 'hono-preact';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// RoutePaths over the manifest produced by the site's defineRoutes call.
type SiteManifest = typeof import('./routes.js').default;
type SitePaths = RoutePaths<SiteManifest>;

// useRouteMatch projects the route's typed params, not Record<string, string>.
export function useRouteMatchReturn() {
  return useRouteMatch('/demo/projects/:projectId');
}

// All checks collected into one exported tuple so `noUnusedLocals` does not flag
// them; each `Expect<...>` still fails compilation if its condition is not true.
export type _TypedRouteParamAssertions = [
  // The deep layout-group leaf is present (the `flat`-omission gotcha).
  Expect<
    '/demo/projects/:projectId/issues/:issueId' extends SitePaths ? true : false
  >,
  // The layout id is present.
  Expect<'/demo/projects/:projectId' extends SitePaths ? true : false>,
  // Param extraction: multi, single, none.
  Expect<
    Equal<
      RouteParams<'/demo/projects/:projectId/issues/:issueId'>,
      { projectId: string } & { issueId: string }
    >
  >,
  Expect<
    Equal<RouteParams<'/demo/projects/:projectId'>, { projectId: string }>
  >,
  Expect<Equal<RouteParams<'/demo/login'>, {}>>,
  // A bogus route id is NOT in the computed union.
  Expect<'/not/a/route' extends SitePaths ? false : true>,
  // useRouteMatch returns the route's typed params (| null), not Record<...>.
  Expect<
    Equal<ReturnType<typeof useRouteMatchReturn>, { projectId: string } | null>
  >,
  // NavLink.match accepts a registered pattern...
  Expect<
    '/demo/projects/:projectId' extends NonNullable<NavLinkProps['match']>
      ? true
      : false
  >,
  // ...and rejects a bogus one.
  Expect<
    '/not/a/route' extends NonNullable<NavLinkProps['match']> ? false : true
  >,
];

// End-to-end: the `declare module` registration actually CONSTRAINS useParams
// (proves the augmentation reached the iso-internal registry, not the `string`
// fallback). If registration ever stops reaching iso, the @ts-expect-error
// below becomes unused and `pnpm typecheck` fails here.
export function useRegistrationReachesIso() {
  // @ts-expect-error '/not/a/route' is not a registered route id
  return useParams('/not/a/route');
}

// Strict input: an unregistered route is a compile error on both hooks.
export function routeActiveRejectsBogusRoutes() {
  // @ts-expect-error '/not/a/route' is not a registered route
  useRouteActive('/not/a/route');
  // @ts-expect-error '/not/a/route' is not a registered route
  useRouteMatch('/not/a/route');
}

// buildPath: pattern autocompletes, params are enforced, param-less routes
// take no second argument, and bogus patterns are rejected.
export function buildPathAssertions() {
  buildPath('/demo/projects/:projectId', { projectId: 'x' });
  buildPath('/demo/login');
  // @ts-expect-error required params object is missing
  buildPath('/demo/projects/:projectId');
  // @ts-expect-error wrong param key
  buildPath('/demo/projects/:projectId', { nope: 'x' });
  // @ts-expect-error not a registered pattern
  buildPath('/not/a/route');
}
