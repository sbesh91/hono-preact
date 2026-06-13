# Typed route params (Section C, primitive 4) design

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Source:** Section C (primitive 4, "typed route params") of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`. Fourth of the six site-discovered primitives.
**Goal:** Kill the stringly-typed `pathParams` access the site hand-maintains: the real `(route.pathParams as { projectId?: string })` cast in `demo/project-layout.tsx` and the unchecked `ctx.location.pathParams.issueId` in `demo/issue.server.ts`. Give the framework full param inference in the TanStack style: the user names a route once, that name is validated against the actual route table, and the params are derived from the route's pattern. No codegen, no runtime registry.

## Scope decisions (locked with user)

1. **Full inference, validated typed-routing (option 1), via a type-only registry (mechanism A).** The user names the route once per consumer (`useParams('/demo/projects/:projectId')`); that string is constrained to the union of real route patterns; the param object is derived from the named pattern. No file-based routing (loaders/components are decoupled from the route table by thunks, so types cannot flow definition->use automatically), and no codegen step (the type machinery is ~45 self-contained lines of template-literal types). This is the realistic ceiling for inference in a manifest-based router.
2. **No new dependency, no TypeScript upgrade.** The workspace already runs `typescript@6.0.3` (an earlier "4.9.4" reading was a stray global Homebrew `tsc` shadowing the workspace binary; `pnpm -r exec tsc`, which `pnpm typecheck` uses, resolves the local 6.0.3). `const` type parameters and recursive template-literal types are native. A spike (`AbsolutePaths` + `RouteParams` + registry fallback, typechecked under `tsc@6.0.3 --strict`) confirmed every assertion. No helper lib (`type-fest`, a codegen router) earns its keep here.
3. **Loaders are covered via a `defineLoader(routeId, fn)` overload** (user's choice). The route id comes first so TypeScript can use it to contextually type `ctx` in the loader fn (a later argument cannot constrain an earlier one, which is why an opts-bag `{ route }` cannot type `ctx`). This drags in the Vite codegen (see the loader-overload section) because the plugin currently treats a string-first `defineLoader` as an invalid form and skips it.
4. **Graceful degradation before registration.** With no `declare module` augmentation, `RegisteredPaths` falls back to `string`, so `useParams`/`defineLoader(routeId, ...)` still compile and return the param shape for whatever literal is passed. Registration only adds validation of the route id against the real table.
5. **Ship as one PR** (iso + vite + site). The type machinery, `useParams`, the `defineLoader` overload, the Vite codegen changes, and both site migrations land together. The two halves share the same type machinery (`typed-routes.ts`, `RegisteredRoutes`, `RouteParams`) and reshapes, so a single PR keeps the feature coherent; the plan sequences the codegen work as its own tasks so the risk stays isolated within the PR.

## The type machinery (internal `packages/iso/src/internal/typed-routes.ts`)

Proven by the spike. Mirrors the runtime path-join rules in `define-routes.tsx` exactly (`here = parent === '' ? path : (path === '' ? parent : ` + "`${parent}/${path}`" + `)` and the `/`-root reset).

```ts
import type { RouteDef } from '../define-routes.js';

// Absolute-path extraction --------------------------------------------------
type Here<Parent extends string, Path extends string> = Parent extends ''
  ? Path
  : Path extends ''
    ? Parent
    : `${Parent}/${Path}`;

type NextParent<H extends string> = H extends '/' ? '' : H;

type NodePaths<R extends RouteDef, Parent extends string> = Here<
  Parent,
  R['path']
> extends infer H
  ? H extends string
    ?
        | (R extends { view: unknown } ? H : never)
        | (R extends { layout: unknown } ? H : never)
        | (R extends { children: infer C }
            ? C extends readonly RouteDef[]
              ? AbsolutePaths<C, NextParent<H>>
              : never
            : never)
    : never
  : never;

export type AbsolutePaths<
  T extends readonly RouteDef[],
  Parent extends string = '',
> = T extends readonly [infer Head, ...infer Tail]
  ? Head extends RouteDef
    ? Tail extends readonly RouteDef[]
      ? NodePaths<Head, Parent> | AbsolutePaths<Tail, Parent>
      : never
    : never
  : never;

// Param extraction ----------------------------------------------------------
type ParamKey<Seg extends string> = Seg extends `${infer Name}?`
  ? { optional: true; name: Name }
  : Seg extends `${infer Name}*`
    ? { optional: true; name: Name }
    : Seg extends `${infer Name}+`
      ? { optional: false; name: Name }
      : { optional: false; name: Seg };

type ParamFrom<Seg extends string> =
  ParamKey<Seg> extends { optional: infer O; name: infer N extends string }
    ? O extends true
      ? { [K in N]?: string }
      : { [K in N]: string }
    : never;

export type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? ParamFrom<Param> & RouteParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? ParamFrom<Param>
      : {};

// Registry indirection ------------------------------------------------------
export interface RegisteredRoutes {
  // Users augment with `paths: RoutePaths<typeof routes>`.
}

export type RegisteredPaths = RegisteredRoutes extends {
  paths: infer P extends string;
}
  ? P
  : string;

export type RoutePaths<M> = M extends {
  __tree?: infer T extends readonly RouteDef[];
}
  ? AbsolutePaths<T>
  : never;
```

`AbsolutePaths` emits the absolute pattern for every node that has a `view` or a `layout` (the route ids a consumer can legitimately name; layouts read params too, e.g. `project-layout.tsx`), and descends into `children` joining segments. It correctly walks layout-group nesting, which is the gotcha that bit primitive #3: the leaf `/demo/projects/:projectId/issues/:issueId` is present here even though `RoutesManifest.flat` omits it. `RouteParams` handles required (`:id`), optional (`:id?`), and the preact-iso modifier suffixes (`*`, `+`); a paramless pattern yields `{}`.

## Reshapes (no casts; backward-compatible)

Two changes to `define-routes.tsx` so a `const`-inferred tree satisfies the constraint and so `typeof routes` carries the literal tree:

1. **`RouteDef.children?: RouteDef[]` -> `readonly RouteDef[]`.** Every internal consumer (`validate`, `collectServerImports`, `collectServerRoutes`, `flattenTree`) already takes `ReadonlyArray<RouteDef>`, so this is a pure widening with no call-site churn. It is required because `const` inference makes nested `children` arrays `readonly`, which the mutable `RouteDef[]` rejects.
2. **`defineRoutes` becomes generic and `RoutesManifest` gains a phantom tree type:**

```ts
export type RoutesManifest<T extends readonly RouteDef[] = readonly RouteDef[]> = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
  serverRoutes: ReadonlyArray<ServerRoute>;
  /** Phantom: carries the literal tree type so `RoutePaths<typeof routes>`
   * can extract the route-pattern union. Never assigned at runtime. */
  readonly __tree?: T;
};

export function defineRoutes<const T extends readonly RouteDef[]>(
  tree: T
): RoutesManifest<T> {
  // body unchanged; the phantom is type-only
}
```

The default type parameter means all four existing `RoutesManifest` references resolve unchanged (`packages/server/src/route-server-modules.ts`, the barrel re-export, the `Routes` props, the definition). The `const` type parameter gives users typed routes **without writing `as const`**; a caller who passes an already-widened `RouteDef[]` variable simply falls back to `string` route ids. The phantom field is optional and never constructed, so `defineRoutes`'s return literal is unchanged at runtime.

## Public API: `useParams`

Re-exported from the iso barrel (`packages/iso/src/index.ts`), surfaced through `hono-preact`:

```ts
// Types
export type { RouteParams, RoutePaths } from './internal/typed-routes.js';
export type { RegisteredRoutes } from './internal/typed-routes.js'; // for `declare module` augmentation
// Hook (new file packages/iso/src/use-params.ts)
export function useParams<P extends RegisteredPaths>(route: P): RouteParams<P>;
```

`useParams`:

```ts
import { useRoute } from 'preact-iso';
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

export function useParams<P extends RegisteredPaths>(route: P): RouteParams<P> {
  // `route` is a type-level selector: it names which route's param shape to
  // project. The live params come from the active route match. The structural
  // read off `Record<string, string>` is the one sanctioned cast boundary
  // (the runtime value genuinely lacks the literal; CLAUDE.md "structural reads").
  void route;
  return useRoute().pathParams as RouteParams<P>;
}
```

Registration (one block in the user's `routes.ts`, next to the `defineRoutes` call):

```ts
export const routes = defineRoutes([...]);

declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routes>;
  }
}
```

After this, `useParams` (and the `defineLoader` overload) constrain the route id to the real pattern union; a typo or a deleted route is a compile error.

## Loader overload: `defineLoader(routeId, fn)`

### iso: generic `LoaderCtx` + the overload

```ts
import type { RouteHook } from 'preact-iso';

export type LoaderCtx<TParams = Record<string, string>> = {
  c: Context;
  location: Omit<RouteHook, 'pathParams'> & { pathParams: TParams };
  signal: AbortSignal;
};

export type Loader<T, TParams = Record<string, string>> =
  | ((ctx: LoaderCtx<TParams>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams>) => AsyncGenerator<T, void, unknown>);

// Overloads on defineLoader (existing first, route-id form second):
export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader<RouteId extends RegisteredPaths, T>(
  route: RouteId,
  fn: Loader<T, RouteParams<RouteId>>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
```

The defaults on `LoaderCtx<TParams>`/`Loader<T, TParams>` keep every existing `LoaderCtx`/`Loader<T>` usage identical (`pathParams: Record<string, string>`). The implementation signature normalizes the two forms: if the first argument is a string, treat the args as `[route, fn, opts]`, else `[fn, opts]`. The route id is type-level only; it is not stored on `LoaderRef` and does not change `params`/cache behavior (the cache-key `params` stays explicit via opts, unchanged).

### vite codegen: make the route-id form a first-class `defineLoader`

The `moduleKeyPlugin` (`packages/vite/src/module-key-plugin.ts`) threads `__moduleKey`/`__loaderName` into every `defineLoader` call inside a `.server.*` module. It currently (a) bails when `arguments.length > 2` and (b) `return`s when the first arg is a `StringLiteral` ("not a valid defineLoader fn form; skip"). Both must change or the route-id form silently gets **no `__moduleKey`**, breaking cross-route cache dedup (the entire reason `__moduleKey` exists). Required changes:

- **`module-key-plugin.ts` `visitCallWithName`:** detect the route-id form (`arguments[0]` is a `StringLiteral`). For it, the fn is `arguments[1]` and opts is `arguments[2]`: with 2 args, append `, { __moduleKey, __loaderName }` after the fn; with 3 args, merge into the `arguments[2]` `ObjectExpression` (bail to a plain key if it is not an object literal, mirroring the existing 2-arg branch). Allow `arguments.length === 3` for this form. Keep the existing fn-first branch (1 arg -> append, 2 args -> merge) unchanged.
- **`server-loaders-parser.ts` (`parseServerLoaders`):** when `call.arguments[0]` is a `StringLiteral`, the opts `ObjectExpression` is `call.arguments[2]` (not `[1]`); the `params` reader (`server-loaders-parser.ts:125`) must read from the shifted position. The returned `call` node is unchanged (still the whole `CallExpression`).
- **`server-loader-validation.ts` / `server-exports-contract.ts`:** confirm the string-first `defineLoader(...)` call still passes export-shape validation (it is still a `defineLoader` call assigned into `serverLoaders`); add a fixture if a gap surfaces.
- **Tests to update (currently assert the skip behavior):** `module-key-plugin.test.ts` "leaves an existing two-arg defineLoader call unchanged" (`defineLoader('movies', async () => ({}))`) must flip to assert `__moduleKey` is now injected as a third arg; add a 3-arg route-id case. `server-loaders-parser.test.ts` gains a route-id-form case asserting `optsArg` resolves to `arguments[2]`.

## Dogfood migrations

- **`apps/site/src/pages/routes.ts` (or wherever `defineRoutes` is called):** add the `declare module 'hono-preact' { interface RegisteredRoutes { paths: RoutePaths<typeof routes> } }` registration block next to the `defineRoutes` call. This unlocks validated route ids for every `useParams`/`defineLoader(routeId, ...)` in the app.
- **`apps/site/src/pages/demo/project-layout.tsx`:** replace `const slug = (route.pathParams as { projectId?: string }).projectId ?? '';` with `const { projectId } = useParams('/demo/projects/:projectId');` (typed `{ projectId: string }`). `projectId` is now a non-optional `string`, so the `?? ''` guard becomes dead; drop it and use `projectId` directly.
- **`apps/site/src/pages/demo/issue.server.ts`:** change the `issue` loader to `defineLoader('/demo/projects/:projectId/issues/:issueId', issueLoader)` (and the sibling `comments`/`activity` loaders likewise if they read params), so `ctx.location.pathParams.issueId` / `.projectId` are typed `string` instead of `Record<string,string>` index access. Loader bodies are otherwise unchanged.

## Docs

- A "Typed route params" section on `apps/site/src/pages/docs/layouts.mdx` (it already introduces dynamic segments and `pathParams.id` for views/layouts at line ~35), showing the one-time `declare module` registration and `useParams('/route/:id')`. Follow the `add-docs-page` conventions (prose + example + a short API note). No new page.
- Extend `apps/site/src/pages/docs/loaders.mdx` (its "Example: detail page (using route params)" section documents `location.pathParams`) with the `defineLoader('/route/:id', fn)` form and a note that `ctx.location.pathParams` is then typed.

## Tests

**Type machinery + `useParams` (`packages/iso/src/__tests__/`):**
- A **type-level test** (a `.ts` file with `Expect<Equal<...>>` assertions, like the spike, run under the normal `pnpm typecheck`) for `AbsolutePaths` over a layout-group tree (asserting the deep leaf pattern is present), `RouteParams` (single/multi/optional/empty), and the `RegisteredPaths` `string` fallback. This is the real oracle for the type machinery.
- A **runtime test** for `useParams`: render a harness inside a route match (mock `useRoute` to return `{ pathParams: { projectId: 'p1' } }`, the `page.test.tsx` mock precedent) and assert `useParams('/demo/projects/:projectId')` returns `{ projectId: 'p1' }`.
- A **typecheck guard** that `defineRoutes([...])` (no `as const`) still yields a usable `RoutePaths<typeof routes>` and that an existing `defineRoutes` caller without registration still compiles.

**Loader overload:**
- iso: a runtime test that `defineLoader('/r/:id', fn)` returns a `LoaderRef` behaviorally identical to `defineLoader(fn)` (the route id is inert at runtime), and a type-level test that `ctx.location.pathParams` is typed from the route id.
- vite: the updated `module-key-plugin.test.ts` (route-id form gets `__moduleKey` injected, 2-arg and 3-arg) and `server-loaders-parser.test.ts` (opts position shift). Run the full vite plugin suite to catch validation regressions.

## Breaking changes

None intended. `useParams`/`RouteParams`/`RoutePaths`/`RegisteredRoutes` and the `defineLoader` overload are additive. `RouteDef.children` widening to `readonly` and `RoutesManifest`/`defineLoader` going generic are source-compatible (defaults + readonly-as-supertype). The site migrations are behavior-preserving. The only behavior change is internal to the Vite plugin: a string-first `defineLoader` call, previously skipped, now gets `__moduleKey` threaded (this is a fix, not a break; no production code used that form before).

## Out of scope (deferred)

- **Dev-mode "named the wrong route" guard.** `useParams` constrains the id to a *valid* pattern but cannot statically prove it matches the *active* route; a dev-only `console.warn` when the active path does not match the named pattern (using the existing `RouteManifestContext` + a matcher) is a nice hardening, deferred to keep `useParams` context-free.
- **Auto-deriving the cache-key `params` from the route id** in `defineLoader(routeId, fn)` (would change cache behavior; keep `params` explicit).
- **Search-param typing** (`searchParams` stays `Record<string, string>`; no schema layer).
- **File-based routing** (the only way to get zero-declaration inference; a much larger change, not one of the six primitives).
- The remaining Section C primitives (#5 single-source guards, #6 content-glob route helper).

## Addendum (2026-06-13): `serverRoute` factory

Folded into the same PR after a design discussion. `defineLoader(routeId, fn)` types loader params but repeats the route id (and, for standalone loaders, the `LoaderCtx<RouteParams<...>>` annotation) per loader. `serverRoute(routeId)` names the route **once per server module** and returns a `.loader(fn)` that infers `ctx.location.pathParams` from the route's pattern, the dominant one-page-one-loader case.

### Portability note (why this is sound)

The route id is **type-level only** (runtime-inert, never stored on the `LoaderRef`), so a loader's runtime portability is unchanged. The fn-first `defineLoader(fn)` form (params `Record<string,string>`) and the explicit `defineLoader(routeId, fn)` form both remain for route-agnostic or shared-across-routes loaders; `serverRoute` is opt-in sugar over the latter, not a constraint. A shared loader written standalone and typed to the param subset it uses (`LoaderCtx<{ id: string }>`) still binds at any route supplying those params via `defineLoader`.

### API (`packages/iso/src/server-route.ts`)

```ts
export interface RouteServer<RouteId extends string> {
  loader<T>(
    fn: Loader<T, RouteParams<RouteId>>,
    opts?: DefineLoaderOpts<T>
  ): LoaderRef<T>;
}

export function serverRoute<const RouteId extends RegisteredPaths>(
  route: RouteId
): RouteServer<RouteId> {
  return { loader: (fn, opts) => defineLoader(route, fn, opts) };
}
```

The route id autocompletes/validates against `RegisteredPaths` exactly like `defineLoader(routeId, ...)`. Barrel-exported (`serverRoute`, `type RouteServer`).

### Vite codegen

`route.loader(fn, opts?)` has the same argument order as fn-first `defineLoader(fn, opts?)`, so the existing injection path handles it once the callee is recognized. Two guard widenings, no new branch:

- `server-loaders-parser.ts` `parseServerLoaders`: accept a `serverLoaders` property value whose callee is a `defineLoader` identifier **or** a non-computed member call with property `loader` (`route.loader(...)`). Its `optsArg` is `arguments[1]` (fn-first), already handled.
- `module-key-plugin.ts` `visitCallWithName`: same callee widening; `.loader(...)` is not a string-first call so it flows through the fn-first append/merge path, threading `__moduleKey`/`__loaderName` into `.loader`'s opts. At runtime `serverRoute.loader` forwards that opts into `defineLoader(route, fn, opts)`, so the cache key threads identically.

`server-loader-validation.ts` is unaffected: it validates export *names* and `pageUse` shape only; `const route = serverRoute(...)` is a non-exported local and never inspects per-loader call shapes. Recognizing `.loader(...)` is safe by the `serverLoaders` contract (its values must be `LoaderRef`s, and only `defineLoader`/`route.loader` produce them).

### Dogfood + docs

`apps/site/src/pages/demo/issue.server.ts` moves to `serverRoute('/demo/projects/:projectId/issues/:issueId')` + inline `route.loader(...)` (drops the `ISSUE_ROUTE` const, the `IssueParams` alias, and the three `LoaderCtx<IssueParams>` annotations). The `loaders.mdx` typed-loader subsection leads with `serverRoute` as the recommended form, with `defineLoader(routeId, fn)` noted as the lower-level / shared-loader door. The `layouts.mdx` typed-params section stays scoped to `useParams` (the client hook) and is unchanged.

### Tests

- iso: `serverRoute('/r/:id').loader(fn)` returns a `LoaderRef` behaviorally identical to `defineLoader('/r/:id', fn)`; the route id is inert at runtime.
- vite: `module-key-plugin.test.ts` injects `__moduleKey`/`__loaderName` into a `serverLoaders = { x: route.loader(fn) }` entry; `server-loaders-parser.test.ts` returns an entry for a `.loader(...)` value with the right name + optsArg.
