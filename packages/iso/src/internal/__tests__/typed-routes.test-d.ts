// Type-level tests for the typed-routes engine. Run under `pnpm test:types`
// (`vitest --typecheck.only`); tsc is the oracle, so a regression in the
// conditional/template-literal types here fails the build. These assert the
// engine in isolation against small synthetic trees; the app-level companion
// (`apps/site/src/typed-route-params.assert.ts`) exercises the same engine
// against the real registered tree.
import { expectTypeOf } from 'vitest';
import type {
  RouteParams,
  AbsolutePaths,
  RoutePaths,
} from '../typed-routes.js';

// ---------------------------------------------------------------------------
// RouteParams — modifier matrix
// ---------------------------------------------------------------------------

// Required `:param`.
expectTypeOf<RouteParams<'/posts/:id'>>().toEqualTypeOf<{ id: string }>();

// Optional `:param?` — the key is optional, not `string | undefined` required.
expectTypeOf<RouteParams<'/files/:id?'>>().toEqualTypeOf<{ id?: string }>();

// Rest `:param*` is optional (zero-or-more).
expectTypeOf<RouteParams<'/files/:rest*'>>().toEqualTypeOf<{ rest?: string }>();

// Rest `:param+` is required (one-or-more).
expectTypeOf<RouteParams<'/files/:rest+'>>().toEqualTypeOf<{ rest: string }>();

// Multiple params compose. The engine builds the object by intersecting each
// segment's contribution (`ParamFrom<P> & RouteParams<Rest>`), so the result
// is the intersection form, not a single merged object literal.
expectTypeOf<
  RouteParams<'/demo/projects/:projectId/tasks/:taskId'>
>().toEqualTypeOf<{ projectId: string } & { taskId: string }>();

// A required param followed by an optional one.
expectTypeOf<RouteParams<'/a/:x/b/:y?'>>().toEqualTypeOf<
  { x: string } & { y?: string }
>();

// Param-less patterns (including the root) yield the empty object.
expectTypeOf<RouteParams<'/docs/components'>>().toEqualTypeOf<{}>();
expectTypeOf<RouteParams<'/'>>().toEqualTypeOf<{}>();

// ---------------------------------------------------------------------------
// #8 — hyphenated (and other non-`[A-Za-z0-9_]`) param names are LITERALS.
//
// `build-path.ts` (and preact-iso's matcher) only recognize `:name` where name
// is `[A-Za-z0-9_]+`; `:foo-bar` does not match its `^:([A-Za-z0-9_]+)[?*+]?$`
// regex, so the runtime keeps the segment verbatim and substitutes nothing.
// The type grammar must agree: a hyphenated segment contributes NO param,
// rather than over-claiming a required `foo-bar`. (Written before the fix as
// the TDD-red cases.)
// ---------------------------------------------------------------------------

// A lone hyphenated segment yields no params (the segment is a literal).
expectTypeOf<RouteParams<'/x/:foo-bar'>>().toEqualTypeOf<{}>();

// A hyphenated segment is skipped, but a valid sibling param survives.
expectTypeOf<RouteParams<'/x/:foo-bar/y/:id'>>().toEqualTypeOf<{
  id: string;
}>();

// A dotted name is equally invalid -> literal.
expectTypeOf<RouteParams<'/x/:a.b'>>().toEqualTypeOf<{}>();

// ---------------------------------------------------------------------------
// AbsolutePaths — join, layout-group nesting, the `/`-reset, and the
// type-invisibility of a non-tuple (runtime-spread) tail.
// ---------------------------------------------------------------------------

// view/layout key presence is read structurally; values are irrelevant.
type SampleTree = readonly [
  { readonly path: '/'; readonly view: unknown },
  { readonly path: '/about'; readonly view: unknown },
  {
    readonly path: '/blog';
    readonly layout: unknown;
    readonly children: readonly [
      // index child (`path: ''`) inherits the parent path verbatim
      { readonly path: ''; readonly view: unknown },
      // dynamic child joins under the layout
      { readonly path: ':slug'; readonly view: unknown },
      // catch-all child
      { readonly path: '*'; readonly view: unknown },
    ];
  },
];

expectTypeOf<AbsolutePaths<SampleTree>>().toEqualTypeOf<
  '/' | '/about' | '/blog' | '/blog/:slug' | '/blog/*'
>();

// A layout/grouping node at `/` resets the child parent to '' so children do
// not pick up a `//` prefix (mirrors `here === '/' ? '' : here`).
type RootGroupTree = readonly [
  {
    readonly path: '/';
    readonly layout: unknown;
    readonly children: readonly [
      { readonly path: 'about'; readonly view: unknown },
    ];
  },
];
expectTypeOf<AbsolutePaths<RootGroupTree>>().toEqualTypeOf<'/' | 'about'>();

// A pure grouping node (no view, no layout) contributes only its descendants,
// never its own path.
type GroupOnlyTree = readonly [
  {
    readonly path: 'group';
    readonly children: readonly [
      { readonly path: 'leaf'; readonly view: unknown },
    ];
  },
];
expectTypeOf<AbsolutePaths<GroupOnlyTree>>().toEqualTypeOf<'group/leaf'>();

// A non-tuple (runtime-spread, e.g. `contentRoutes(import.meta.glob(...))`)
// tail is type-invisible: it contributes `never`, never widening the union.
type SpreadTree = readonly [
  { readonly path: '/x'; readonly view: unknown },
  ...{ readonly path: string; readonly view: unknown }[],
];
expectTypeOf<AbsolutePaths<SpreadTree>>().toEqualTypeOf<'/x'>();

// ---------------------------------------------------------------------------
// RoutePaths — accepts both the route-tree array and a `{ __tree }` manifest,
// and resolves to the same union as AbsolutePaths over the tree.
// ---------------------------------------------------------------------------

expectTypeOf<RoutePaths<SampleTree>>().toEqualTypeOf<
  '/' | '/about' | '/blog' | '/blog/:slug' | '/blog/*'
>();

expectTypeOf<RoutePaths<{ __tree: SampleTree }>>().toEqualTypeOf<
  AbsolutePaths<SampleTree>
>();

// A path outside the computed union is not a member.
expectTypeOf<'/not/a/route'>().not.toEqualTypeOf<RoutePaths<SampleTree>>();
