// Compile-time assertions for the typed-route-params engine, exercised against
// the real site route tree. Not imported anywhere; `pnpm typecheck` is the
// oracle. If the type engine or the route registration regresses, tsc fails.
import { useParams } from 'hono-preact';
import type { RoutePaths, RouteParams } from 'hono-preact';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// RoutePaths over the manifest produced by the site's defineRoutes call.
type SiteManifest = typeof import('./routes.js').default;
type SitePaths = RoutePaths<SiteManifest>;

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
];

// End-to-end: the `declare module` registration actually CONSTRAINS useParams
// (proves the augmentation reached the iso-internal registry, not the `string`
// fallback). If registration ever stops reaching iso, the @ts-expect-error
// below becomes unused and `pnpm typecheck` fails here.
export function useRegistrationReachesIso() {
  // @ts-expect-error '/not/a/route' is not a registered route id
  return useParams('/not/a/route');
}
