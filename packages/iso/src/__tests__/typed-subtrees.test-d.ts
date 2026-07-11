// Subtree-pattern derivation for `serverRoute('<layout path>/*')` typing.
// TreeSubtrees (the tree-form walker) and SubtreePatterns (the paths-only
// fallback heuristic) are pure type functions, so both are asserted against
// literal fixtures here; live registered-union acceptance
// (serverRoute('/demo/projects/*') in apps/site) is enforced by
// `pnpm typecheck` through the site's tree-form route registration.
import { expectTypeOf } from 'vitest';
import type {
  AbsolutePaths,
  RegisteredPaths,
  RegisteredSubtrees,
  RouteParams,
  RouteSubtrees,
  SubtreePatterns,
  TreeSubtrees,
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

// The serverRoute parameter shape (RegisteredPaths | RegisteredSubtrees) for
// a PATHS-ONLY registration, mirrored with an explicit union so
// acceptance/rejection is checkable in a package test (the global
// registration lives in apps/site). Pins the heuristic fallback: a paths-only
// registration keeps deriving subtrees from the union, descendants required.
declare function bindLike<
  const R extends SitePaths | SubtreePatterns<SitePaths>,
>(route: R): R;
bindLike('/demo/projects/*');
bindLike('/demo/projects');
// @ts-expect-error a leaf path has no subtree pattern
bindLike('/demo/login/*');

// --- Tree-form registration ({ tree: typeof routeTree }) ---
// TreeSubtrees walks the tree structurally, so a type-level tree with `Thunk`
// members stands in for the real `as const` value tree without importing any
// component modules. The walker keys off `children` presence, exactly like
// the runtime collectRouteUse subtree emission.
type Thunk = () => Promise<unknown>;

type TreeFixture = readonly [
  { path: '/'; view: Thunk },
  {
    // A guard-only grouping node: `use` + `children`, no layout/view. Its
    // path is not in AbsolutePaths, but its subtree IS bindable.
    path: '/admin';
    use: unknown;
    children: readonly [
      { path: 'users'; view: Thunk },
      { path: 'settings'; view: Thunk },
    ];
  },
  {
    // An index-only layout: the only child is the empty-path index, so the
    // paths heuristic sees no strict descendant. The tree walker still emits
    // its subtree, matching the runtime key.
    path: '/movies';
    layout: Thunk;
    children: readonly [{ path: ''; view: Thunk }];
  },
  { path: '/login'; view: Thunk },
];

// Every children-bearing node emits its subtree; leaves emit nothing. Note
// the contrast with the paths heuristic over the same tree, which derives
// only '/*' (the grouping node is unregistered, the index-only layout has no
// strict descendant in the union).
expectTypeOf<TreeSubtrees<TreeFixture>>().toEqualTypeOf<
  '/admin/*' | '/movies/*'
>();
expectTypeOf<
  SubtreePatterns<AbsolutePaths<TreeFixture>>
>().toEqualTypeOf<'/*'>();

// The root node's own subtree is '/*' (SubtreeOf's '/' special case), emitted
// when the root has children.
type RootedTree = readonly [
  {
    path: '/';
    layout: Thunk;
    children: readonly [{ path: ''; view: Thunk }];
  },
];
expectTypeOf<TreeSubtrees<RootedTree>>().toEqualTypeOf<'/*'>();

// Children of a root '/' node join through the root reset: bare ('x') and
// slashed ('/y') child spellings both derive the absolute '/x' form, the
// empty-path index child folds into '/', and subtree spellings follow the
// same join. These are the same strings the runtime walkers key
// (collectRouteUse / collectServerRoutes), so a serverRoute binding under a
// root layout typechecks with exactly the spelling the boot guard accepts.
type RootChildrenTree = readonly [
  {
    path: '/';
    layout: Thunk;
    children: readonly [
      { path: ''; view: Thunk },
      { path: 'x'; view: Thunk },
      {
        path: '/y';
        use: unknown;
        children: readonly [{ path: 'z'; view: Thunk }];
      },
    ];
  },
];
expectTypeOf<AbsolutePaths<RootChildrenTree>>().toEqualTypeOf<
  '/' | '/x' | '/y/z'
>();
expectTypeOf<TreeSubtrees<RootChildrenTree>>().toEqualTypeOf<'/*' | '/y/*'>();

// RouteSubtrees mirrors RoutePaths: it accepts the tree array form or the
// manifest `__tree` form and applies the same walker.
expectTypeOf<RouteSubtrees<TreeFixture>>().toEqualTypeOf<
  '/admin/*' | '/movies/*'
>();
expectTypeOf<RouteSubtrees<{ __tree?: TreeFixture }>>().toEqualTypeOf<
  '/admin/*' | '/movies/*'
>();

// The serverRoute parameter shape under a TREE-FORM registration: grouping
// and index-only-layout wildcards are accepted, leaf wildcards are rejected.
declare function treeBindLike<
  const R extends AbsolutePaths<TreeFixture> | TreeSubtrees<TreeFixture>,
>(route: R): R;
treeBindLike('/admin/*');
treeBindLike('/movies/*');
treeBindLike('/movies');
// @ts-expect-error a leaf node emits no subtree pattern
treeBindLike('/login/*');
// @ts-expect-error a grouping node has no exact page pattern, only a subtree
treeBindLike('/admin');
