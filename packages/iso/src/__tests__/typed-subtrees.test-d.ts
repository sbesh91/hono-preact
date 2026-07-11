// Subtree-pattern derivation for `serverRoute('<layout path>/*')` typing.
// SubtreePatterns is a pure function of a path union, so the algebra is
// asserted against literal unions here; live registered-union acceptance
// (serverRoute('/demo/projects/*') in apps/site) is enforced by
// `pnpm typecheck` through the site's route registration.
import { expectTypeOf } from 'vitest';
import type {
  RegisteredPaths,
  RegisteredSubtrees,
  RouteParams,
  SubtreePatterns,
} from '../internal/typed-routes.js';

// Mirrors the shape of the docs site's registered union.
type SitePaths =
  | '/'
  | '/docs'
  | '/docs/*'
  | '/demo'
  | '/demo/login'
  | '/demo/projects'
  | '/demo/projects/:projectId'
  | '/demo/projects/:projectId/tasks/:taskId';

// Every member with a registered strict descendant derives `${P}/*`; leaves
// ('/demo/login', the '/docs/*' catch-all itself) derive nothing. '/' derives
// '/*' because every other member descends from it. '/docs/*' appears both as
// the catch-all's exact registered path and as '/docs' subtree; the union
// dedups the string.
expectTypeOf<SubtreePatterns<SitePaths>>().toEqualTypeOf<
  | '/*'
  | '/docs/*'
  | '/demo/*'
  | '/demo/projects/*'
  | '/demo/projects/:projectId/*'
>();

// A leaf-only union derives nothing.
expectTypeOf<SubtreePatterns<'/a' | '/b'>>().toEqualTypeOf<never>();

// Unregistered fallback: RegisteredPaths is `string`, no subtree literal is
// derivable, and serverRoute's parameter stays effectively `string`.
expectTypeOf<RegisteredSubtrees>().toEqualTypeOf<never>();
expectTypeOf<RegisteredPaths>().toEqualTypeOf<string>();

// Wildcard binders type exactly the prefix params: the bare trailing `*`
// contributes no param, matching deriveLayoutLocation's runtime stripping.
expectTypeOf<RouteParams<'/demo/projects/*'>>().toEqualTypeOf<{}>();
expectTypeOf<RouteParams<'/a/:org/*'>>().toEqualTypeOf<{ org: string }>();

// The serverRoute parameter shape (RegisteredPaths | RegisteredSubtrees),
// mirrored with an explicit union so acceptance/rejection is checkable in a
// package test (the global registration lives in apps/site).
declare function bindLike<
  const R extends SitePaths | SubtreePatterns<SitePaths>,
>(route: R): R;
bindLike('/demo/projects/*');
bindLike('/demo/projects');
// @ts-expect-error a leaf path has no subtree pattern
bindLike('/demo/login/*');
