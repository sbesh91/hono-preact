# Typed route params (Section C #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the framework full, validated route-param inference (TanStack-style): the user names a route once, the name is checked against the real route table, and params are derived from the pattern. Ship `useParams(routeId)`, a `defineLoader(routeId, fn)` overload, and a type-only registry; migrate the two site cast/stringly sites.

**Architecture:** A ~45-line recursive template-literal type engine (`AbsolutePaths` walks the route tree exactly as the runtime joins paths; `RouteParams` extracts `:param` names) plus a registry interface users augment with one `declare module 'hono-preact'` block. `defineRoutes` becomes `defineRoutes<const T>` returning a `RoutesManifest<T>` carrying a phantom tree type. The loader half adds a `defineLoader(routeId, fn)` overload and the matching Vite codegen so `__moduleKey` is still threaded through the new arity. No new dependency; no codegen of source.

**Tech Stack:** TypeScript 6.0.3 (workspace `pnpm -r exec tsc`), preact, preact-iso, `@babel/parser` + MagicString (Vite plugin), Vitest + `@testing-library/preact` (happy-dom).

**Source spec:** `docs/superpowers/specs/2026-06-12-typed-route-params-design.md`.

**Conventions:**
- Run a single iso/ui test file with `pnpm exec vitest run <path>` from the repo root; the vite plugin suite with `pnpm --filter @hono-preact/vite test` (or `pnpm exec vitest run packages/vite/...`).
- No em-dashes in code/comments/commit messages.
- Run `pnpm format` before the pre-push step (`.mdx` and `.ts` are checked).
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- The iso package's `tsconfig.json` EXCLUDES `src/**/__tests__/**` from typecheck, so type-level assertions there are NOT CI-covered. The CI oracle for exact type shapes is a pure-type file in `apps/site/src/` (typechecked by `pnpm typecheck`, emits nothing). Runtime behavior is tested with Vitest in iso.

## Note on the registry mechanism (verified)

A spike confirmed that `declare module 'hono-preact' { interface RegisteredRoutes { paths: ... } }` merges into the interface that `@hono-preact/iso` declares and re-exports (augmentation through a `export type` re-export reaches the original interface). So `RegisteredPaths`, computed in iso, sees the user's augmentation. The site dogfood (Task 6) is the end-to-end confirmation: if the cross-package `.d.ts` boundary ever behaved differently, `useParams('/typo')` would stop erroring and the assertions file (Task 6) would fail. If that ever happens, the fallback is a global `interface HonoPreactRegisteredRoutes` augmented via `declare global`; not expected to be needed.

## File map

- **Create** `packages/iso/src/internal/typed-routes.ts`: the type engine (`AbsolutePaths`, `RouteParams`, `RegisteredRoutes`, `RegisteredPaths`, `RoutePaths`).
- **Modify** `packages/iso/src/define-routes.tsx`: `RouteDef.children` readonly; `RoutesManifest<T>` phantom; `defineRoutes<const T>`.
- **Create** `packages/iso/src/use-params.ts` + `packages/iso/src/__tests__/use-params.test.tsx`.
- **Modify** `packages/iso/src/define-loader.ts`: generic `LoaderCtx<TParams>` / `Loader<T, TParams>`; `defineLoader(routeId, fn)` overload + impl normalization.
- **Create** `packages/iso/src/__tests__/define-loader-route-id.test.ts`.
- **Modify** `packages/iso/src/index.ts`: export `useParams`, `RouteParams`, `RoutePaths`, `RegisteredRoutes`.
- **Modify** `packages/vite/src/server-loaders-parser.ts`: opts position shifts to `arguments[2]` for the route-id form.
- **Modify** `packages/vite/src/module-key-plugin.ts`: thread `__moduleKey`/`__loaderName` into the route-id form.
- **Modify** `packages/vite/src/__tests__/module-key-plugin.test.ts` and `server-loaders-parser.test.ts`: flip/extend the route-id cases.
- **Modify** `apps/site/src/routes.ts`: name the manifest + `declare module 'hono-preact'` registration.
- **Modify** `apps/site/src/pages/demo/project-layout.tsx`: `useParams`.
- **Modify** `apps/site/src/pages/demo/issue.server.ts`: `defineLoader(routeId, fn)`.
- **Create** `apps/site/src/typed-route-params.assert.ts`: compile-time exact-shape assertions (CI oracle).
- **Modify** `apps/site/src/pages/docs/layouts.mdx` and `loaders.mdx`: docs.

---

## Task 1: Reshape `define-routes.tsx` for `const` inference

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`

- [ ] **Step 1: Widen `RouteDef.children` to readonly.** In `packages/iso/src/define-routes.tsx`, change the `RouteDef` type's `children` field:
```ts
  children?: readonly RouteDef[];
```
(was `children?: RouteDef[];`). Every internal consumer already takes `ReadonlyArray<RouteDef>`, so nothing else changes here.

- [ ] **Step 2: Make `RoutesManifest` generic with a phantom tree.** Replace the `RoutesManifest` type declaration with:
```ts
export type RoutesManifest<
  T extends readonly RouteDef[] = readonly RouteDef[],
> = {
  tree: ReadonlyArray<RouteDef>;
  flat: ReadonlyArray<FlatRoute>;
  serverImports: ReadonlyArray<LazyServerImport>;
  /**
   * Path-keyed view of every server module in the tree. (existing doc comment
   * unchanged -- keep it.)
   */
  serverRoutes: ReadonlyArray<ServerRoute>;
  /**
   * Phantom: carries the literal route-tree type so `RoutePaths<typeof routes>`
   * can extract the route-pattern union for typed params. Never assigned at
   * runtime; the `?` keeps the `defineRoutes` return object unchanged.
   */
  readonly __tree?: T;
};
```
Keep the existing JSDoc on `serverRoutes`. The default type parameter means the four existing `RoutesManifest` references (no type args) resolve unchanged.

- [ ] **Step 3: Make `defineRoutes` preserve the literal tree.** Change the signature:
```ts
export function defineRoutes<const T extends readonly RouteDef[]>(
  tree: T
): RoutesManifest<T> {
  validate(tree);
  const viewCache = new Map<unknown, ComponentType<ViewProps>>();
  const keyCache = new Map<ComponentType<ViewProps>, string>();
  return {
    tree,
    flat: flattenTree(tree, viewCache, keyCache),
    serverImports: collectServerImports(tree),
    serverRoutes: collectServerRoutes(tree),
  };
}
```
The `const` type parameter infers literal route paths without the caller writing `as const`; the body is otherwise unchanged. The returned object omits `__tree` (optional); the `RoutesManifest<T>` annotation is what carries `T` into `typeof routes`.

- [ ] **Step 4: Build + typecheck iso, and run the existing route tests.** Run:
```bash
pnpm --filter @hono-preact/iso build && pnpm typecheck && pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx
```
Expected: PASS. (If `pnpm typecheck` reports an error in `packages/server/src/route-server-modules.ts` or the example apps about `RoutesManifest`, it means the default type param was dropped; re-check Step 2. If a `Cannot find module '@hono-preact/...'` error appears, run `pnpm install` and retry.)

- [ ] **Step 5: Commit.**
```bash
git add packages/iso/src/define-routes.tsx
git commit -m "refactor(iso): defineRoutes preserves literal tree for typed params

RouteDef.children is now readonly and RoutesManifest carries a phantom
tree type so a const-inferred tree's route patterns can be derived at
the type level. Backward-compatible via the default type parameter.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The type engine (`internal/typed-routes.ts`)

**Files:**
- Create: `packages/iso/src/internal/typed-routes.ts`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Create the type engine.** Create `packages/iso/src/internal/typed-routes.ts`:
```ts
import type { RouteDef } from '../define-routes.js';

// Absolute-path extraction. Mirrors the runtime join in define-routes.tsx:
//   here = parent === '' ? path : (path === '' ? parent : `${parent}/${path}`)
// and the `/`-root reset (a layout/grouping at `/` joins children from '').
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

/**
 * The union of absolute route patterns for every view/layout node in a route
 * tree (the ids a consumer can legitimately name). Walks layout-group nesting,
 * which `RoutesManifest.flat` omits.
 */
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

// Param extraction. Handles required `:id`, optional `:id?`, and the preact-iso
// modifier suffixes `*` / `+`. A pattern with no `:param` yields `{}`.
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

/** Extract the path-params object type from an absolute route pattern. */
export type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? ParamFrom<Param> & RouteParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? ParamFrom<Param>
      : {};

/**
 * Augment this interface to register your app's routes for typed params:
 *
 * ```ts
 * declare module 'hono-preact' {
 *   interface RegisteredRoutes {
 *     paths: RoutePaths<typeof routes>;
 *   }
 * }
 * ```
 *
 * Until registered, `RegisteredPaths` falls back to `string` (the param hooks
 * still work; they just accept any string and project its param shape).
 */
export interface RegisteredRoutes {
  // augmented by users
}

export type RegisteredPaths = RegisteredRoutes extends {
  paths: infer P extends string;
}
  ? P
  : string;

/** The route-pattern union of a manifest produced by `defineRoutes`. */
export type RoutePaths<M> = M extends {
  __tree?: infer T extends readonly RouteDef[];
}
  ? AbsolutePaths<T>
  : never;
```

- [ ] **Step 2: Re-export the public types from the barrel.** In `packages/iso/src/index.ts`, in the "Declarative route tree" block (right after the `export type { RouteDef, RoutesManifest, ... } from './define-routes.js';` block, before "Server bindings"), add:
```ts
// Typed route params.
export type {
  RouteParams,
  RoutePaths,
  RegisteredRoutes,
} from './internal/typed-routes.js';
```
(`RegisteredPaths` and `AbsolutePaths` stay internal; `useParams`/`defineLoader` import them directly from the internal module. `RegisteredRoutes` MUST be on the barrel so `declare module 'hono-preact'` can target it.)

- [ ] **Step 3: Build + typecheck.** Run:
```bash
pnpm --filter @hono-preact/iso build && pnpm typecheck
```
Expected: PASS. (The types have no runtime; this just confirms they compile and the barrel re-export resolves. If a Section B boundary test about barrel exports later fails in the pre-push step, it is because these three new public types need allow-listing; handle it there.)

- [ ] **Step 4: Commit.**
```bash
git add packages/iso/src/internal/typed-routes.ts packages/iso/src/index.ts
git commit -m "feat(iso): route-param type engine + RegisteredRoutes registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The `useParams` hook

**Files:**
- Create: `packages/iso/src/use-params.ts`
- Create: `packages/iso/src/__tests__/use-params.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/iso/src/__tests__/use-params.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useParams } from '../use-params.js';

const mockRoute = { path: '/demo/projects/p1', searchParams: {}, pathParams: {} as Record<string, string> };
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRoute: () => mockRoute };
});

afterEach(cleanup);

function Harness({ onParams }: { onParams: (p: unknown) => void }) {
  const params = useParams('/demo/projects/:projectId');
  onParams(params);
  return null;
}

describe('useParams', () => {
  it('returns the live route pathParams for the named route', () => {
    mockRoute.pathParams = { projectId: 'p1' };
    let seen: unknown;
    render(<Harness onParams={(p) => (seen = p)} />);
    expect(seen).toEqual({ projectId: 'p1' });
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../use-params.js`).
```bash
pnpm exec vitest run packages/iso/src/__tests__/use-params.test.tsx
```

- [ ] **Step 3: Create the hook.** Create `packages/iso/src/use-params.ts`:
```ts
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
```

- [ ] **Step 4: Add the barrel export.** In `packages/iso/src/index.ts`, in the `// Hooks.` section (after the `export { useNavigate, ... }` line), add:
```ts
export { useParams } from './use-params.js';
```

- [ ] **Step 5: Run the test; expect PASS.**
```bash
pnpm exec vitest run packages/iso/src/__tests__/use-params.test.tsx
```

- [ ] **Step 6: Build + typecheck.**
```bash
pnpm --filter @hono-preact/iso build && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/iso/src/use-params.ts packages/iso/src/__tests__/use-params.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): useParams hook for typed route params

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The `defineLoader(routeId, fn)` overload (iso)

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Create: `packages/iso/src/__tests__/define-loader-route-id.test.ts`

- [ ] **Step 1: Make `LoaderCtx` / `Loader` generic over params.** In `packages/iso/src/define-loader.ts`, replace the `LoaderCtx` and `Loader` declarations:
```ts
export type LoaderCtx<TParams = Record<string, string>> = {
  c: Context;
  location: Omit<RouteHook, 'pathParams'> & { pathParams: TParams };
  signal: AbortSignal;
};

export type Loader<T, TParams = Record<string, string>> =
  | ((ctx: LoaderCtx<TParams>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams>) => AsyncGenerator<T, void, unknown>);
```
The defaults keep every existing `LoaderCtx` / `Loader<T>` usage identical (`pathParams: Record<string, string>`). `LoaderRef<T>.fn` stays `Loader<T>` (defaulted params); no change needed there.

- [ ] **Step 2: Add the imports.** At the top of `define-loader.ts`, add to the existing type import from the internal types:
```ts
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
```

- [ ] **Step 3: Add the overload declarations + normalize the impl.** Replace the single `export function defineLoader<T>(fn, opts?)` signature + body opening with overloads and a normalizing implementation signature:
```ts
export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader<RouteId extends RegisteredPaths, T>(
  route: RouteId,
  fn: Loader<T, RouteParams<RouteId>>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader(
  fnOrRoute: Loader<unknown> | string,
  fnOrOpts?: Loader<unknown> | DefineLoaderOpts<unknown>,
  maybeOpts?: DefineLoaderOpts<unknown>
): LoaderRef<unknown> {
  // Normalize the two overload forms. The route id is type-level only (it
  // selects the param shape for the loader fn); it is not stored on the ref
  // and does not affect cache/`params` behavior.
  const isRouteForm = typeof fnOrRoute === 'string';
  const fn = (isRouteForm ? fnOrOpts : fnOrRoute) as Loader<unknown>;
  const opts = (
    isRouteForm ? maybeOpts : fnOrOpts
  ) as DefineLoaderOpts<unknown> | undefined;

  validateTimeoutMs(opts?.timeoutMs, 'defineLoader');
  // ... rest of the existing body UNCHANGED (it already reads `fn` and `opts`).
}
```
The rest of the function body (from `const idKey = ...` through `return ref;`) is unchanged; it already references `fn` and `opts`, which now come from the normalization above. The two `as` casts are the standard overload-implementation widening (the public overloads guarantee the real shapes), not a user-facing reshape.

- [ ] **Step 4: Write the test.** Create `packages/iso/src/__tests__/define-loader-route-id.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { defineLoader, type LoaderCtx } from '../define-loader.js';

describe('defineLoader(routeId, fn) overload', () => {
  it('returns a LoaderRef behaviorally identical to defineLoader(fn)', () => {
    const fn = async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true });
    const ref = defineLoader('/things/:id', fn);
    expect(typeof ref.__id).toBe('symbol');
    expect(ref.fn).toBe(fn);
    expect(ref.params).toEqual([]);
    expect(typeof ref.invalidate).toBe('function');
  });

  it('threads opts through the third argument', () => {
    const fn = async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true });
    const ref = defineLoader('/things/:id', fn, { params: ['q'] });
    expect(ref.params).toEqual(['q']);
  });

  it('still supports the fn-first form', () => {
    const fn = async () => ({ ok: true });
    const ref = defineLoader(fn, { params: '*' });
    expect(ref.fn).toBe(fn);
    expect(ref.params).toBe('*');
  });
});
```

- [ ] **Step 5: Run the test; expect PASS.**
```bash
pnpm exec vitest run packages/iso/src/__tests__/define-loader-route-id.test.ts
```

- [ ] **Step 6: Build + typecheck.**
```bash
pnpm --filter @hono-preact/iso build && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader-route-id.test.ts
git commit -m "feat(iso): defineLoader(routeId, fn) overload for typed loader params

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Vite codegen for the route-id loader form

**Files:**
- Modify: `packages/vite/src/server-loaders-parser.ts`
- Modify: `packages/vite/src/module-key-plugin.ts`
- Modify: `packages/vite/src/__tests__/server-loaders-parser.test.ts`
- Modify: `packages/vite/src/__tests__/module-key-plugin.test.ts`

- [ ] **Step 1: Update the parser to find opts at the shifted position.** In `packages/vite/src/server-loaders-parser.ts`, inside `parseServerLoaders`, replace the opts-extraction block (currently reading `call.arguments[1]`):
```ts
        // The route-id overload `defineLoader('/r/:id', fn, opts?)` shifts the
        // opts object to the third argument; the fn-first form keeps it second.
        const isRouteForm = call.arguments[0]?.type === 'StringLiteral';
        const optsCandidate = isRouteForm
          ? call.arguments[2]
          : call.arguments[1];
        const optsArg =
          optsCandidate?.type === 'ObjectExpression'
            ? (optsCandidate as ObjectExpression)
            : null;

        entries.push({ name: prop.key.name, call, optsArg });
```
(Replaces the old `const secondArg = call.arguments[1]; const optsArg = ...; entries.push(...)`.) This also fixes `server-only.ts`'s `readParamsOpt(entry.optsArg)` for the route-id form, since it reads `entry.optsArg`.

- [ ] **Step 2: Update the parser test.** In `packages/vite/src/__tests__/server-loaders-parser.test.ts`, add a route-id case to the `describe` that covers `optsArg` (right after the "non-ObjectExpression second arg has optsArg === null" test, before the closing `});` of that describe):
```ts
  it('reads opts from the third arg for the route-id form', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader('/things/:id', async () => ({}), { params: ['q'] }),
      };
    `);
    const [entry] = parseServerLoaders(program);
    expect(entry.optsArg?.type).toBe('ObjectExpression');
  });

  it('route-id form with no opts has optsArg === null', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader('/things/:id', async () => ({})),
      };
    `);
    const [entry] = parseServerLoaders(program);
    expect(entry.optsArg).toBeNull();
  });
```

- [ ] **Step 3: Run the parser test; expect PASS.**
```bash
pnpm exec vitest run packages/vite/src/__tests__/server-loaders-parser.test.ts
```

- [ ] **Step 4: Teach the module-key plugin the route-id form.** In `packages/vite/src/module-key-plugin.ts`, replace the body of `visitCallWithName` (from the `if (node.arguments.length === 0 ...)` guard through the end of the function) with route-id-aware logic:
```ts
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'defineLoader'
        ) {
          return;
        }
        const args = node.arguments;
        if (args.length === 0) return;

        const namePartAfter = loaderName
          ? `, ${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}`
          : '';
        const namePartBefore = loaderName
          ? `${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}, `
          : '';
        const appendOptsAfter = (afterEnd: number) =>
          s.appendRight(
            afterEnd,
            `, { ${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}${namePartAfter} }`
          );
        const mergeInto = (opts: typeof args[number]) => {
          if (opts.type !== 'ObjectExpression') return;
          const insertAt = opts.properties[0]?.start ?? opts.start! + 1;
          s.appendRight(
            insertAt,
            `${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}, ${namePartBefore}`
          );
        };

        const isRouteForm = args[0].type === 'StringLiteral';
        if (isRouteForm) {
          // defineLoader('/r/:id', fn) | defineLoader('/r/:id', fn, opts)
          if (args.length < 2 || args.length > 3) return;
          if (args.length === 2) {
            const fnEnd = args[1].end;
            if (fnEnd == null) return;
            appendOptsAfter(fnEnd);
          } else {
            mergeInto(args[2]);
          }
          return;
        }

        // fn-first form: defineLoader(fn) | defineLoader(fn, opts)
        if (args.length > 2) return;
        if (args.length === 1) {
          const fnEnd = args[0].end;
          if (fnEnd == null) return;
          appendOptsAfter(fnEnd);
          return;
        }
        mergeInto(args[1]);
```
This preserves the existing fn-first behavior and adds the route-id branch (2-arg appends opts after the fn; 3-arg merges into the existing opts object).

- [ ] **Step 5: Update the module-key plugin tests.** In `packages/vite/src/__tests__/module-key-plugin.test.ts`, REPLACE the test titled `'leaves an existing two-arg defineLoader call unchanged'` (the one passing `defineLoader('movies', async () => ({}))`) with route-id-form expectations:
```ts
  it('threads __moduleKey into the route-id form (two args)', () => {
    const plugin = makePlugin();
    const code = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `export const loader = defineLoader('/movies/:id', async () => ({}));`,
    ].join('\n');
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result?.code).toContain(
      `defineLoader('/movies/:id', async () => ({}), { __moduleKey: "src/pages/movies" })`
    );
  });

  it('merges __moduleKey into the route-id form opts (three args)', () => {
    const plugin = makePlugin();
    const code = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `export const loader = defineLoader('/movies/:id', async () => ({}), { params: ['q'] });`,
    ].join('\n');
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result?.code).toContain('__moduleKey: "src/pages/movies"');
    expect(result?.code).toContain(`params: ['q']`);
  });
```

- [ ] **Step 6: Run the module-key plugin test; expect PASS.**
```bash
pnpm exec vitest run packages/vite/src/__tests__/module-key-plugin.test.ts
```

- [ ] **Step 7: Run the full vite plugin suite** to catch any server-only / validation regression from the parser change:
```bash
pnpm --filter @hono-preact/vite test
```
Expected: PASS. (If `server-only-plugin.test.ts` or `server-loader-validation-plugin.test.ts` fails, inspect whether it asserts a behavior the parser change altered; the parser change only shifts WHERE opts is read for string-first calls, so any failure indicates a fixture using a string-first form that previously had no opts detected. Add a route-id fixture if needed, but do not loosen validation.)

- [ ] **Step 8: Build vite + typecheck.**
```bash
pnpm --filter @hono-preact/vite build && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/vite/src/server-loaders-parser.ts packages/vite/src/module-key-plugin.ts \
  packages/vite/src/__tests__/server-loaders-parser.test.ts \
  packages/vite/src/__tests__/module-key-plugin.test.ts
git commit -m "feat(vite): thread __moduleKey through defineLoader(routeId, fn)

The route-id loader overload puts a string first and may take a third
opts arg; the module-key plugin now injects the key into that arity and
the serverLoaders parser reads opts from the shifted position.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Site dogfood + the CI type-shape oracle

**Files:**
- Modify: `apps/site/src/routes.ts`
- Modify: `apps/site/src/pages/demo/project-layout.tsx`
- Modify: `apps/site/src/pages/demo/issue.server.ts`
- Create: `apps/site/src/typed-route-params.assert.ts`

- [ ] **Step 1: Register the routes.** In `apps/site/src/routes.ts`, name the manifest and add the registration block. Change the default export from `export default defineRoutes([...])` to a named const, and import `RoutePaths`:
```ts
import { defineRoutes, type RoutePaths } from 'hono-preact';
```
At the bottom, replace `export default defineRoutes([` ... `]);` so the array is assigned to a const that is both exported and referenced by the registration:
```ts
const routes = defineRoutes([
  // ... the existing tree, unchanged ...
]);

export default routes;

declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routes>;
  }
}
```
(Keep the existing `docsView` const and the `./docs-transition.js` side-effect import.)

- [ ] **Step 2: Migrate `project-layout.tsx` to `useParams`.** In `apps/site/src/pages/demo/project-layout.tsx`:
  - Change the import line `import { useRoute, useRouteChange, ViewTransitionName } from 'hono-preact';` to drop `useRoute` and add `useParams`:
```ts
import { useParams, useRouteChange, ViewTransitionName } from 'hono-preact';
```
  - Replace the two lines:
```ts
  const route = useRoute();
  const slug = (route.pathParams as { projectId?: string }).projectId ?? '';
```
with:
```ts
  const { projectId: slug } = useParams('/demo/projects/:projectId');
```
(`slug` is now a typed non-optional `string`; the rest of the component is unchanged.)

- [ ] **Step 3: Migrate `issue.server.ts` loaders to the route-id form.** In `apps/site/src/pages/demo/issue.server.ts`:
  - Add `RouteParams` to the `hono-preact` import:
```ts
import {
  defineAction,
  defineLoader,
  type LoaderCtx,
  type RouteParams,
} from 'hono-preact';
```
  - Below the imports (before `type WithAuthor`), add a single shared route-id const + param alias:
```ts
const ISSUE_ROUTE = '/demo/projects/:projectId/issues/:issueId';
type IssueParams = RouteParams<typeof ISSUE_ROUTE>;
```
  - Change each loader's `ctx: LoaderCtx` annotation to `ctx: LoaderCtx<IssueParams>` (three loaders: `issueLoader`, `commentsLoader`, `activityLoader`). The bodies are unchanged; `ctx.location.pathParams.issueId` / `.projectId` are now typed `string`.
  - Change the `serverLoaders` object to pass the route id first:
```ts
export const serverLoaders = {
  issue: defineLoader(ISSUE_ROUTE, issueLoader),
  comments: defineLoader(ISSUE_ROUTE, commentsLoader),
  activity: defineLoader(ISSUE_ROUTE, activityLoader),
};
```
(`serverActions` are unchanged.)

- [ ] **Step 4: Create the type-shape oracle.** Create `apps/site/src/typed-route-params.assert.ts` (a compile-time-only file; never imported, emits nothing, but typechecked by `pnpm typecheck`):
```ts
// Compile-time assertions for the typed-route-params engine, exercised against
// the real site route tree. Not imported anywhere; `pnpm typecheck` is the
// oracle. If the type engine or the route registration regresses, tsc fails.
import type { RoutePaths, RouteParams } from 'hono-preact';
import type routes from './routes.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type SitePaths = RoutePaths<typeof routes>;

// The deep layout-group leaf is present (the `flat`-omission gotcha).
type _LeafPresent = Expect<
  '/demo/projects/:projectId/issues/:issueId' extends SitePaths ? true : false
>;
// The layout id is present.
type _LayoutPresent = Expect<
  '/demo/projects/:projectId' extends SitePaths ? true : false
>;

// Param extraction: multi, single, none.
type _Multi = Expect<
  Equal<
    RouteParams<'/demo/projects/:projectId/issues/:issueId'>,
    { projectId: string } & { issueId: string }
  >
>;
type _Single = Expect<
  Equal<RouteParams<'/demo/projects/:projectId'>, { projectId: string }>
>;
type _None = Expect<Equal<RouteParams<'/demo/login'>, {}>>;

// A bogus route id is NOT in the union (registration actually constrains).
type _Bogus = Expect<'/not/a/route' extends SitePaths ? false : true>;
```

- [ ] **Step 5: Build the framework, then typecheck + build the site.** Run (framework first so the site resolves the new exports through `dist/`):
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck && pnpm --filter site build
```
Expected: PASS. (If `pnpm typecheck` fails inside `typed-route-params.assert.ts`, the type engine or registration is wrong: read the failing assertion. If `useParams('/demo/projects/:projectId')` reports the arg is not assignable to `RegisteredPaths`, the `declare module` augmentation did not reach iso, see the registry note at the top; the fallback is a global interface.)

- [ ] **Step 6: Run the site docs/page tests + the demo integration** to confirm no behavior change:
```bash
pnpm exec vitest run apps/site/src/pages/docs/__tests__
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add apps/site/src/routes.ts apps/site/src/pages/demo/project-layout.tsx \
  apps/site/src/pages/demo/issue.server.ts apps/site/src/typed-route-params.assert.ts
git commit -m "refactor(site): adopt typed route params (useParams + defineLoader routeId)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Docs

**Files:**
- Modify: `apps/site/src/pages/docs/layouts.mdx`
- Modify: `apps/site/src/pages/docs/loaders.mdx`

- [ ] **Step 1: Document `useParams` on `layouts.mdx`.** Read `apps/site/src/pages/docs/layouts.mdx` and find the spot just after it introduces dynamic segments / `pathParams.id` (around line 35). Add a `## Typed route params` section (follow the `add-docs-page` template conventions: prose, a code example, a short API note). Use this content:
````md
## Typed route params

Register your route tree once and `useParams` gives you typed params for any
route, validated against the real routes. Add this next to your `defineRoutes`
call (e.g. in `routes.ts`):

```ts
import { defineRoutes, type RoutePaths } from 'hono-preact';

const routes = defineRoutes([
  /* ... */
]);
export default routes;

declare module 'hono-preact' {
  interface RegisteredRoutes {
    paths: RoutePaths<typeof routes>;
  }
}
```

Then name the route you are on; the params are inferred from its pattern:

```tsx
import { useParams } from 'hono-preact';

function ProjectLayout() {
  // projectId is typed `string`; a typo'd or unknown route id is a type error.
  const { projectId } = useParams('/projects/:projectId');
  return <h1>{projectId}</h1>;
}
```

Before you register the routes, `useParams` still works: it accepts any string
and returns that pattern's param shape.
````
Read the page first to match its heading style and the `CodeTabs`/import conventions used by neighboring sections; if the page uses `import` blocks for components, mirror that.

- [ ] **Step 2: Document the loader form on `loaders.mdx`.** Read `apps/site/src/pages/docs/loaders.mdx`, find the "Example: detail page (using route params)" section (around line 112) that documents `location.pathParams`. Add a short note + example right after that section showing the typed form:
````md
### Typed loader params

Pass the route id as the first argument to `defineLoader` and `ctx.location.pathParams`
is typed from the route's pattern (requires the one-time route registration shown
in [Layouts](/docs/layouts#typed-route-params)):

```ts
export const serverLoaders = {
  // location.pathParams.id is typed `string`
  default: defineLoader('/movies/:id', async ({ location }) => {
    return getMovie(location.pathParams.id);
  }),
};
```
````
Match the page's existing fence/`CodeTabs` style.

- [ ] **Step 3: Verify docs parse + parity + prettier.** Run:
```bash
pnpm exec vitest run apps/site/src/pages/docs/__tests__
pnpm --filter site build
pnpm exec prettier --check apps/site/src/pages/docs/layouts.mdx apps/site/src/pages/docs/loaders.mdx
```
Expected: PASS. (If prettier flags either file, `pnpm exec prettier --write` it and re-check. The docs-template-check PostToolUse hook is a soft warn; address any template gap it reports.)

- [ ] **Step 4: Commit.**
```bash
git add apps/site/src/pages/docs/layouts.mdx apps/site/src/pages/docs/loaders.mdx
git commit -m "docs: typed route params (useParams + defineLoader routeId)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full pre-push verification

**Files:** none.

- [ ] **Step 1: Run the six-step CI mirror in order, each expecting PASS:**
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails,** run `pnpm format`, restage into the relevant commit or a `style:` commit, and re-run from Step 1.

- [ ] **Step 3: Boundary-export check.** If a Section B public/internal boundary test fails because `RouteParams` / `RoutePaths` / `RegisteredRoutes` are newly on the main barrel, add them to that test's allow-list (they are intended public API). Do not remove the exports.

- [ ] **Step 4: Flake note.** If `measure-client-size` times out under load, re-run it in isolation (`pnpm exec vitest run scripts/__tests__/measure-client-size.test.mjs`) before treating it as real. The client-size sticky comment may move by a few bytes (a new hook export); that is expected.

---

## Self-review

- **Spec coverage:** type engine (Task 2), the `defineRoutes`/`RouteDef` reshapes (Task 1), `useParams` (Task 3), the `defineLoader(routeId, fn)` overload (Task 4) and its Vite codegen + flipped tests (Task 5), the registration + both site migrations + the CI type oracle (Task 6), docs on `layouts.mdx` + `loaders.mdx` (Task 7), full pre-push (Task 8). The deferred items (dev-mode wrong-route guard, auto-derived cache params, search-param typing, file-based routing) are correctly absent.
- **Placeholder scan:** every code step has full code; the two `as` casts (overload-impl normalization in Task 4, the structural pathParams read in Task 3) are the spec's single sanctioned boundary, justified in comments. No TODO/TBD.
- **Type/name consistency:** `RouteParams` / `RoutePaths` / `RegisteredRoutes` / `RegisteredPaths` / `AbsolutePaths` are spelled identically across Tasks 2, 3, 4, 6; `__tree` matches between `RoutesManifest` (Task 1) and `RoutePaths` (Task 2); `LoaderCtx<TParams>` matches between the iso change (Task 4) and the site annotation (Task 6); the `defineLoader` overload's `(route, fn, opts?)` arity matches the plugin's 2-arg/3-arg handling (Task 5) and the parser's shifted opts position (Task 5).
- **Codegen parity:** the predecessor behavior (string-first `defineLoader` skipped, no `__moduleKey`) is intentionally replaced by injection; the two tests asserting the old skip are flipped (Task 5, Step 5) and the parser's `optsArg` consumer (`server-only.ts`) is covered by the central parser fix (Task 5, Step 1).
