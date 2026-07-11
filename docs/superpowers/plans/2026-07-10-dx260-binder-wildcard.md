# Wildcard Subtree Binder + Aliasing Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `serverRoute('<layout path>/*')` as the subtree-scope binding spelling (typed, runtime-resolved, boot-validated), plus a dev-only warning when an exact layout-path binding is aliased by its index child's own `use`, and migrate the site exemplar and docs to teach the two spellings.

**Architecture:** `collectRouteUse` gains a `'<path>/*'` entry per children-bearing node carrying that node's own composed chain (ancestors outer-first plus own `use`, never a child's additions). A new `RegisteredSubtrees` type derives `'${P}/*'` from the registered paths union, widening `serverRoute`'s parameter without touching `buildPath`/`useParams`. The boot asserts (`assertRouteBindingsMatchMount` / `assertRegistryRouteBindingsValid`) validate wildcard bindings against the new keys (fail closed on a childless path) and, in dev, report exact-path bindings whose sibling subtree chain differs (the aliasing signal, no new plumbing). The `#263` warning's `findBestPattern` depth tiebreak makes it suggest the wildcard for layout-location requests automatically.

**Tech Stack:** TypeScript template-literal types, vitest (+ `--typecheck.only` for `*.test-d.ts`), pnpm workspace, Hono.

## Global Constraints

- **Working tree:** ALL work happens in the worktree `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder` on branch `dx/260-binder` (PR #267). Every Read/Edit/Write path MUST be an absolute path with this worktree prefix. Run every command from this directory.
- **No em-dashes** in any prose, code comment, commit message, or docs text you write. Use commas, colons, parentheses, or two sentences.
- **No inline type casts** (`as T`). Reshape types instead. The only sanctioned cast boundaries here are the pre-existing structural reads of user module exports in `route-binding-guard.ts` (keep those as they are).
- **TDD:** every task writes the failing test first, runs it to see the failure, implements, re-runs to green, then commits.
- **Commit trailer:** every commit message ends with the exact line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Semantics (binding, from the spec):** `'/x/*'` names ONE tree node (the node at `/x`) and resolves, statically at declaration time, the chain every descendant inherits: ancestors outer-first, then the node's own `use`, WITHOUT any child's additions. Never per-request deepest-match. Guard resolution stays exact-key (`byPattern`); the URL fuzzy-match exists only in the observational dev warning.
- **Dist staleness:** `pnpm typecheck` and `apps/site` resolve cross-package types through built `dist/`. After changing `packages/iso` or `packages/server` source, rebuild before running `pnpm typecheck` or site tests: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.
- **Docs policy:** describe what IS. No history, no "formerly/previously" breadcrumbs, no mention of the interim exact-path exemplar state.
- **Do not push** without the full 8-step CI parity run passing (Task 8), and never force-push.

---

### Task 1: Type derivation: `RegisteredSubtrees` and the widened `serverRoute` parameter

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/internal/typed-routes.ts` (append after the `RoutePattern` type, around line 141)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/server-route.ts` (imports at line 12, signature at line 179, jsdoc above it)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/index.ts` (typed-routes type export block, lines 27-32)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/__tests__/typed-subtrees.test-d.ts` (new)

**Interfaces:**
- Consumes: existing `RegisteredPaths`, `RegisteredRoutes`, `RouteParams` in `typed-routes.ts`.
- Produces: `export type SubtreePatterns<Paths extends string>` and `export type RegisteredSubtrees` (both from `internal/typed-routes.ts`; `RegisteredSubtrees` also re-exported from the iso barrel and thus from `hono-preact` via its `export *`). `serverRoute` signature becomes `serverRoute<const RouteId extends RegisteredPaths | RegisteredSubtrees>(route: RouteId): RouteBinder<RouteId>`. Tasks 2-6 rely on the string shape `path === '/' ? '/*' : path + '/*'`.

- [ ] **Step 1: Write the failing type test**

Create `packages/iso/src/__tests__/typed-subtrees.test-d.ts`:

```ts
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
```

- [ ] **Step 2: Run the type tests to verify failure**

Run: `pnpm test:types 2>&1 | tail -20`
Expected: FAIL on `typed-subtrees.test-d.ts` with `Module '"../internal/typed-routes.js"' has no exported member 'SubtreePatterns'` (and `'RegisteredSubtrees'`).

- [ ] **Step 3: Implement the derivation in `typed-routes.ts`**

Append after the `RoutePattern` type (line 141), before `RoutePaths`:

```ts
// A path's subtree pattern. The root's subtree is '/*', not '//*', mirroring
// the runtime key construction in `subtreePatternOf` (define-routes.tsx).
type SubtreeOf<P extends string> = P extends '/' ? '/*' : `${P}/*`;

// `${P}/*` when P has at least one registered strict descendant, else never.
// `All` is the FULL registered union (captured before distribution); the
// Exclude guards the root case, where '/' itself matches `/${string}`.
type SubtreeFrom<P extends string, All extends string> = [
  Exclude<Extract<All, P extends '/' ? `/${string}` : `${P}/${string}`>, P>,
] extends [never]
  ? never
  : SubtreeOf<P>;

/**
 * The subtree-pattern union derivable from a path union: `${P}/*` for every
 * member `P` that has another member as a strict descendant. A pure function
 * of the union (directly testable); `RegisteredSubtrees` applies it to the
 * registered paths. The `[Paths] extends [infer All ...]` capture is
 * deliberate: it binds the whole union before the distributive
 * `Paths extends string` step, so each member is checked against every
 * other member.
 */
export type SubtreePatterns<Paths extends string> = [Paths] extends [
  infer All extends string,
]
  ? Paths extends string
    ? SubtreeFrom<Paths, All>
    : never
  : never;

/**
 * `${P}/*` for every registered path with a registered descendant: the
 * subtree-scope spellings `serverRoute` accepts alongside the exact
 * registered paths. Resolves to `never` until routes are registered
 * (`RegisteredPaths` then falls back to `string`, which already admits any
 * spelling). Deliberately NOT part of `RegisteredPaths`, so `buildPath` and
 * `useParams` autocompletion stay on navigable patterns.
 */
export type RegisteredSubtrees = SubtreePatterns<RegisteredPaths>;
```

- [ ] **Step 4: Widen `serverRoute` and export the type**

In `packages/iso/src/server-route.ts`, change the import at line 12 and the signature at line 179:

```ts
import type {
  RegisteredPaths,
  RegisteredSubtrees,
  RouteParams,
} from './internal/typed-routes.js';
```

```ts
export function serverRoute<
  const RouteId extends RegisteredPaths | RegisteredSubtrees,
>(route: RouteId): RouteBinder<RouteId> {
```

Extend the jsdoc above `serverRoute` (after the existing example block, before the `__routeId` paragraph) with:

```
 * A layout or grouping node's SUBTREE binds with the wildcard spelling,
 * `serverRoute('/movies/*')`: the returned binder resolves the `use` chain
 * every descendant of `/movies` inherits (ancestors outer-first, then the
 * node's own `use`), without the index child's additions. The exact path
 * (`serverRoute('/movies')`) is the page scope, the pattern's deepest
 * composed chain. `RouteParams` of a wildcard pattern are the prefix params
 * only, matching the derived layout location the loader receives.
```

In `packages/iso/src/index.ts`, extend the typed-routes export block (lines 27-32) to:

```ts
export type {
  RouteParams,
  RoutePaths,
  RegisteredRoutes,
  RegisteredSubtrees,
} from './internal/typed-routes.js';
```

- [ ] **Step 5: Run the type tests to verify pass**

Run: `pnpm test:types 2>&1 | tail -10`
Expected: PASS, including `typed-subtrees.test-d.ts` (all existing `*.test-d.ts` files stay green; in particular `server-route.test-d.ts` still compiles with the widened parameter).

- [ ] **Step 6: Rebuild dist and typecheck**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: both succeed (the widened parameter is additive; the site's existing `serverRoute('/demo/projects')` still typechecks).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/typed-routes.ts packages/iso/src/server-route.ts packages/iso/src/index.ts packages/iso/src/__tests__/typed-subtrees.test-d.ts
git commit -m "feat(iso): derive RegisteredSubtrees and widen serverRoute to subtree patterns

'\${P}/*' is derived for every registered path with a registered strict
descendant, so existing route registrations gain the subtree spellings with
no user action. buildPath/useParams stay on RegisteredPaths (nav surface
unpolluted). RouteParams of a wildcard pattern are the prefix params only.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Runtime: subtree `routeUse` entries from `collectRouteUse`

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/define-routes.tsx` (routeUse doc comment lines 101-109, `collectRouteUse` lines 286-318, new exported helper)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/index.ts` (add `subtreePatternOf` to the define-routes export group)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/iso/src/__tests__/define-routes-server.test.tsx` (extend the `routeUse` describe; reuse its existing `noopView` / `noopLayout` / `a` / `b` helpers)

**Interfaces:**
- Consumes: `joinRoutePath`, `composeUse`, `PageUse` (already in `define-routes.tsx`).
- Produces: `export function subtreePatternOf(path: string): string` (returns `'/*'` for `'/'`, else `path + '/*'`), exported from `@hono-preact/iso`; `manifest.routeUse` now contains one `{ path: subtreePatternOf(here), use: composed }` entry per children-bearing node. Tasks 3-5 import `subtreePatternOf` in `packages/server`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('routeUse', ...)` block of `define-routes-server.test.tsx`:

```tsx
it('emits a subtree entry per children-bearing node carrying its own composed chain', () => {
  const m = defineRoutes([
    {
      path: '/app',
      layout: noopLayout,
      use: [a],
      children: [
        { path: '', view: noopView, use: [b] },
        { path: 'leaf', view: noopView },
      ],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  // Subtree key: the layout node's own composed chain, WITHOUT the index
  // child's additions.
  expect(byPath.get('/app/*')).toEqual([a]);
  // Exact key: unchanged deepest-wins semantics (index child's chain).
  expect(byPath.get('/app')).toEqual([a, b]);
});

it('emits a subtree entry for a guard-only grouping node', () => {
  const m = defineRoutes([
    {
      path: '/admin',
      use: [a],
      children: [{ path: 'data', view: noopView }],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  expect(byPath.get('/admin/*')).toEqual([a]);
  // The grouping node still has no exact entry of its own (no view/server).
  expect(byPath.has('/admin')).toBe(false);
});

it('a literal `*` child deepest-wins over the parent subtree key', () => {
  const m = defineRoutes([
    {
      path: '/docs',
      layout: noopLayout,
      use: [a],
      children: [
        { path: 'guide', view: noopView },
        { path: '*', view: noopView, use: [b] },
      ],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  // The catch-all child and the layout subtree share the string '/docs/*';
  // the child's chain (a superset: inherited + own) wins the dedup, so the
  // collision's failure direction stays over-guarding.
  expect(byPath.get('/docs/*')).toEqual([a, b]);
});

it('a root layout subtree keys as /*', () => {
  const m = defineRoutes([
    {
      path: '/',
      layout: noopLayout,
      use: [a],
      children: [{ path: 'x', view: noopView }],
    },
  ]);
  const byPath = new Map(m.routeUse.map((r) => [r.path, r.use]));
  expect(byPath.get('/*')).toEqual([a]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/iso/src/__tests__/define-routes-server.test.tsx 2>&1 | tail -20`
Expected: the four new tests FAIL (`byPath.get('/app/*')` is `undefined`); all pre-existing tests in the file PASS.

- [ ] **Step 3: Implement the emission**

In `define-routes.tsx`, add the helper directly above `collectRouteUse`:

```ts
/**
 * The subtree pattern for a route node's path: the key under which the node's
 * own composed chain (the chain every descendant inherits) is registered in
 * `routeUse`. Mirrors the matcher grammar's trailing `*` (route-pattern.ts in
 * the server package) and the type-level `SubtreePatterns` derivation. The
 * emitter here and the boot validator (`route-binding-guard.ts`) must agree
 * on this construction, so it lives in one place.
 *
 * Framework-private: exported for `@hono-preact/server`, not a user API.
 */
export function subtreePatternOf(path: string): string {
  return path === '/' ? '/*' : path + '/*';
}
```

Rewrite the loop body of `collectRouteUse`'s inner `walk` (lines 302-309) to:

```ts
for (const r of rs) {
  const here = joinRoutePath(parentPath, r.path);
  const composed: PageUse = composeUse(inherited, r.use);
  if (r.view || r.server) {
    ordered.push({ path: here, use: composed });
  }
  if (r.children) {
    // Subtree key: the node's own composed chain (ancestors outer-first,
    // then own `use`), WITHOUT any child's additions. Emitted for every
    // children-bearing node (layout groups AND guard-only grouping nodes),
    // so `serverRoute('<path>/*')` gets its own map key distinct from the
    // node's empty-path index child. Pushed BEFORE the children so a
    // literal `path: '*'` child producing the same string wins the
    // deepest-wins dedup below.
    ordered.push({ path: subtreePatternOf(here), use: composed });
    walk(r.children, here, composed);
  }
}
```

Replace the `routeUse` doc comment on `RoutesManifest` (lines 101-109) with:

```ts
  /**
   * Composed page-layer `use` per bindable route pattern. Two kinds of key:
   *
   * - An exact pattern per node with a `view` or `server` module: the page
   *   scope. Ancestor `use` folds in outer-first; a layout and its
   *   empty-path index child share one string and the deepest node's chain
   *   wins, so the exact key carries the index child's own `use` too.
   * - A `<path>/*` subtree pattern per children-bearing node (layout groups
   *   and guard-only grouping nodes): the subtree scope, the node's own
   *   composed chain without any child's additions, i.e. the chain every
   *   descendant inherits. A literal `path: '*'` child produces the same
   *   string as its parent's subtree key; the child's (superset) chain wins
   *   the dedup, keeping that collision over-guarding.
   *
   * Route-bound units (`serverRoute(pattern)`) resolve their RPC `use`
   * chain from these keys by exact lookup, never by request URL.
   */
```

Add `subtreePatternOf` to the `export { ... } from './define-routes.js';` group in `packages/iso/src/index.ts` (the block ending at line 20).

- [ ] **Step 4: Run to verify pass, then blast-radius suites**

Run: `pnpm vitest run packages/iso/src/__tests__/define-routes-server.test.tsx 2>&1 | tail -6`
Expected: PASS (all tests, including the untouched exact-key assertions, which are the regression pin for existing entries).

Run the routeUse consumers' suites (resolver, matcher, entry wiring, handler, actions, sockets, build-inner-routes; all consume `routeUse` or the manifest):

`pnpm vitest run packages/server/src/__tests__/page-use-resolver.test.ts packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/create-server-entry.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/route-binding-guard.test.ts packages/iso/src/__tests__/build-inner-routes.test.tsx packages/iso/src/__tests__/define-routes.test.tsx 2>&1 | tail -8`
Expected: PASS (all these hand-build `routeUse` or key off exact paths; new keys are additive).

Then the full unit sweep: `pnpm test 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/index.ts packages/iso/src/__tests__/define-routes-server.test.tsx
git commit -m "feat(iso): emit subtree routeUse entries for children-bearing nodes

Every node with children (layout groups and guard-only grouping nodes) now
also registers '<path>/*' carrying its own composed chain, giving the
subtree binder its own key distinct from the index child's deepest-wins
entry and making guard-only prefixes bindable. Exact keys are unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Boot validation: accept subtree bindings, fail closed on childless wildcards

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/route-binding-guard.ts` (both assert functions, new context type)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/create-server-entry.ts` (lines 124-150, the boot-check block)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/route-binding-guard.test.ts`

**Interfaces:**
- Consumes: `subtreePatternOf` from `@hono-preact/iso` (Task 2), `routes.routeUse` in `create-server-entry.ts`.
- Produces: `export type RouteBindingCheckContext = { routeUseByPattern: ReadonlyMap<string, ReadonlyArray<unknown>>; onAliasedBinding?: (info: AliasedBindingInfo) => void }` and `export type AliasedBindingInfo = { kind: 'loader' | 'action'; name: string; routeId: string; subtreeId: string }`. New signatures: `assertRouteBindingsMatchMount(serverRoutes, ctx)` and `assertRegistryRouteBindingsValid(registry, ctx)`. Task 5 fills in `onAliasedBinding`; this task only threads the context (`onAliasedBinding` stays unused here).

- [ ] **Step 1: Update the test scaffolding and write the failing tests**

In `route-binding-guard.test.ts`, add below the existing `routeOf` helper:

```ts
const ctxOf = (
  entries: ReadonlyArray<[string, ReadonlyArray<unknown>]>
): RouteBindingCheckContext => ({ routeUseByPattern: new Map(entries) });
```

with `RouteBindingCheckContext` added to the import from `'../route-binding-guard.js'`.

Convert every existing call site (this is the signature migration; the assertions themselves do not change):
- Each `assertRouteBindingsMatchMount(routes)` becomes `assertRouteBindingsMatchMount(routes, ctxOf([['<mount path>', []]]))` using that test's mount path (e.g. `[['/movies/:id', []]]`).
- The registry describe's `const patterns = new Set(['/reports', '/reports/:id'])` becomes `const ctx = ctxOf([['/reports', []], ['/reports/:id', []]])`, and every `assertRegistryRouteBindingsValid(registry, patterns)` becomes `assertRegistryRouteBindingsValid(registry, ctx)`.

Then append the new cases:

```ts
describe('subtree (wildcard) bindings', () => {
  it('mount accepts <path>/* when the subtree key exists', async () => {
    const routes = [
      routeOf('/movies', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/movies/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(
        routes,
        ctxOf([
          ['/movies', []],
          ['/movies/*', []],
        ])
      )
    ).resolves.toBeUndefined();
  });

  it('mount rejects <path>/* on a childless route (fail closed)', async () => {
    const routes = [
      routeOf('/movies/:id', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/movies/:id/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/movies/:id', []]]))
    ).rejects.toThrow(
      /binds the subtree pattern '\/movies\/:id\/\*', but route '\/movies\/:id' has no child routes/
    );
  });

  it('mount still rejects a wildcard naming a DIFFERENT route', async () => {
    const routes = [
      routeOf('/movies', {
        __moduleKey: 'm',
        serverLoaders: { shell: bound('/other/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(
        routes,
        ctxOf([
          ['/movies', []],
          ['/movies/*', []],
        ])
      )
    ).rejects.toThrow(
      /is bound to route '\/other\/\*', but its module is registered on route '\/movies'/
    );
  });

  it('registry accepts a subtree binding whose key exists', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/reports',
        serverLoaders: { totals: bound('/reports/*') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(
        registry,
        ctxOf([
          ['/reports', []],
          ['/reports/*', []],
        ])
      )
    ).resolves.toBeUndefined();
  });

  it('registry rejects a subtree binding with no such key', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/reports',
        serverLoaders: { totals: bound('/nope/*') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/reports', []]]))
    ).rejects.toThrow(/bound to route '\/nope\/\*', which is not a route/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/server/src/__tests__/route-binding-guard.test.ts 2>&1 | tail -20`
Expected: compile failure (`RouteBindingCheckContext` not exported; asserts take 1 or a Set-typed 2nd arg). That is the failing state.

- [ ] **Step 3: Implement the guard changes**

In `route-binding-guard.ts`:

Add after the imports (extend the iso import: `import { subtreePatternOf, type ServerRoute } from '@hono-preact/iso';`):

```ts
export type BoundUnitKind = 'loader' | 'action';

export type AliasedBindingInfo = {
  kind: BoundUnitKind;
  name: string;
  /** The exact pattern the unit is bound to (the page scope). */
  routeId: string;
  /** The sibling subtree pattern (the subtree scope). */
  subtreeId: string;
};

export type RouteBindingCheckContext = {
  /**
   * Every routeUse pattern mapped to its composed page-use chain
   * (`new Map(routes.routeUse.map((r) => [r.path, r.use]))`). Key presence
   * validates bindings (`byPattern` fails open on a miss, so a bound
   * pattern must be a real key); the chain values feed the dev-only
   * aliasing diagnostic.
   */
  routeUseByPattern: ReadonlyMap<string, ReadonlyArray<unknown>>;
  /**
   * Dev-only observer: called for each exact-path binding whose pattern
   * also has a sibling subtree key with a DIFFERENT chain (the deepest-wins
   * exact entry was widened by the index child's own `use`). Purely
   * diagnostic, never feeds guard resolution. Omit in prod for zero cost.
   */
  onAliasedBinding?: (info: AliasedBindingInfo) => void;
};

function sameChain(
  a: ReadonlyArray<unknown>,
  b: ReadonlyArray<unknown>
): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

// Dev-only observational check behind ctx.onAliasedBinding. The exact entry
// differing from the sibling subtree entry IS the aliasing signal: both come
// from the same collectRouteUse walk, and they diverge exactly when the
// index child (or a same-string deeper node) declared its own `use`.
function maybeReportAliasedBinding(
  kind: BoundUnitKind,
  name: string,
  routeId: string,
  ctx: RouteBindingCheckContext
): void {
  if (!ctx.onAliasedBinding || routeId.endsWith('/*')) return;
  const subtreeId = subtreePatternOf(routeId);
  const exact = ctx.routeUseByPattern.get(routeId);
  const subtree = ctx.routeUseByPattern.get(subtreeId);
  if (exact === undefined || subtree === undefined) return;
  if (sameChain(exact, subtree)) return;
  ctx.onAliasedBinding({ kind, name, routeId, subtreeId });
}
```

Rewrite `assertRouteBindingsMatchMount` (keep its doc comment, appending one sentence: `A module mounted on a children-bearing node may alternatively bind its subtree pattern (route.path + '/*'), which must exist as a routeUse key; a wildcard on a childless path fails here rather than resolving an empty chain at request time.`):

```ts
export async function assertRouteBindingsMatchMount(
  serverRoutes: ReadonlyArray<ServerRoute>,
  ctx: RouteBindingCheckContext
): Promise<void> {
  await Promise.all(
    serverRoutes.map(async (route) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await route.server()) as SelfModule;
      const subtreeId = subtreePatternOf(route.path);
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId !== 'string') continue;
          if (routeId === route.path) {
            maybeReportAliasedBinding(kind, name, routeId, ctx);
            continue;
          }
          if (routeId === subtreeId) {
            if (ctx.routeUseByPattern.has(subtreeId)) continue;
            throw new Error(
              `Route-bound ${kind} '${name}' binds the subtree pattern '${subtreeId}', ` +
                `but route '${route.path}' has no child routes, so no subtree entry ` +
                `exists and the binding would resolve an empty page-level \`use\` ` +
                `chain. Bind serverRoute('${route.path}') for the route itself, or ` +
                `give '${route.path}' children to make its subtree bindable.`
            );
          }
          throw new Error(
            `Route-bound ${kind} '${name}' is bound to route '${routeId}', but its ` +
              `module is registered on route '${route.path}'. A route-bound ${kind} must ` +
              `use serverRoute('${route.path}') (the page scope) or ` +
              `serverRoute('${subtreeId}') (the subtree scope, when the route has child ` +
              `routes) to match the route it is mounted on; otherwise it resolves its ` +
              `page-level \`use\` (auth) chain from the wrong route.`
          );
        }
      }
    })
  );
}
```

Rewrite `assertRegistryRouteBindingsValid`'s signature and body (doc comment: replace the `validRoutePatterns` sentence with `routeUse carries an entry for every bindable pattern, exact and subtree (see iso collectRouteUse), so we require the __routeId to be one of those keys.`):

```ts
export async function assertRegistryRouteBindingsValid(
  registry: ReadonlyArray<() => Promise<unknown>>,
  ctx: RouteBindingCheckContext
): Promise<void> {
  await Promise.all(
    registry.map(async (load) => {
      // Structural read of a user-defined module's exports (a sanctioned cast
      // boundary); only the server-unit containers and their `__routeId` are read.
      const mod = (await load()) as SelfModule;
      for (const [container, kind] of CONTAINERS) {
        const exports = readExports(mod[container]);
        if (!exports) continue;
        for (const [name, value] of Object.entries(exports)) {
          const routeId = (value as RouteBoundExport).__routeId;
          if (typeof routeId !== 'string') continue;
          if (!ctx.routeUseByPattern.has(routeId)) {
            throw new Error(
              `Route-bound ${kind} '${name}' in the src/server registry is bound to ` +
                `route '${routeId}', which is not a route in your route table. A ` +
                `serverRoute('${routeId}') unit must target a real route pattern so it ` +
                `resolves that route's page-level \`use\` (auth) chain; otherwise it would ` +
                `run under no gates. Fix the pattern to match a route in routes.ts (an ` +
                `exact pattern like '/movies/:id', or a subtree pattern like '/movies/*' ` +
                `for a node with child routes), or move the unit to that route's module.`
            );
          }
          maybeReportAliasedBinding(kind, name, routeId, ctx);
        }
      }
    })
  );
}
```

In `create-server-entry.ts`, replace the boot-check block (lines 137-142; keep the surrounding comment, updating its last paragraph to say the registry check keys off the routeUse map, which now includes subtree patterns):

```ts
  const bindingCheckContext: RouteBindingCheckContext = {
    routeUseByPattern: new Map(routes.routeUse.map((r) => [r.path, r.use])),
  };
  const runBootChecks = () =>
    Promise.all([
      assertRouteBindingsMatchMount(routes.serverRoutes, bindingCheckContext),
      assertRegistryRouteBindingsValid(serverRegistry, bindingCheckContext),
    ]).then(() => undefined);
```

and add `RouteBindingCheckContext` to the existing import from `'./route-binding-guard.js'` (type import).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/server/src/__tests__/route-binding-guard.test.ts packages/server/src/__tests__/create-server-entry.test.ts 2>&1 | tail -8`
Expected: PASS (existing mismatch-message regexes still match: the first sentence of the mismatch error is unchanged).

Rebuild and typecheck (server signature changed, iso helper is consumed cross-package):
Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-binding-guard.ts packages/server/src/create-server-entry.ts packages/server/src/__tests__/route-binding-guard.test.ts
git commit -m "feat(server): validate subtree bindings at boot via routeUse keys

Both boot asserts now take a RouteBindingCheckContext carrying the
routeUse pattern map. A colocated module may bind route.path or its
subtree pattern; a wildcard on a childless path fails closed at boot with
a dedicated message (byPattern fails open, so the key must exist).
Registry bindings validate against the same map, which now includes the
subtree keys.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Pin subtree chain resolution end-to-end and the #263 wildcard suggestion

**Files:**
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/loaders-handler.test.ts` (extend the `bare-loader guarded-route dev warning` describe and add a subtree-chain describe)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/route-server-modules.test.ts` (extend `makeGuardedRouteMatcher`)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/route-pattern.test.ts` (one tiebreak pin)

No production code changes in this task: `loadersHandler` dispatch and the warning template are untouched by design (routeId `'/x/*'` hits the new key; `findBestPattern`'s depth tiebreak picks the deeper wildcard).

**Interfaces:**
- Consumes: `defineRoutes`, `serverRoute`, `defineServerMiddleware` from `@hono-preact/iso`; `loadersHandler`; `makeGuardedRouteMatcher`; `findBestPattern`.
- Produces: nothing new; regression pins only.

- [ ] **Step 1: Write the tests**

In `route-pattern.test.ts` append:

```ts
it('prefers the deeper wildcard key over an equal-scoring bare prefix', () => {
  // '/x' and '/x/*' score identically (the trailing * scores 0); depth
  // breaks the tie. The #263 warning's suggestion for layout-location
  // requests relies on this.
  expect(findBestPattern(['/x', '/x/*'], '/x')).toBe('/x/*');
});
```

In `route-server-modules.test.ts`, inside `describe('makeGuardedRouteMatcher', ...)` append:

```ts
it('suggests the subtree pattern for a layout-location request', () => {
  const gate = () => {};
  const match = makeGuardedRouteMatcher([
    { path: '/demo/projects', use: [gate] },
    { path: '/demo/projects/*', use: [gate] },
    { path: '/demo/projects/:projectId', use: [gate] },
  ]);
  // Equal literal score for the exact and wildcard keys; the deeper
  // wildcard wins, so the #263 warning names the subtree spelling for a
  // layout-location request.
  expect(match('/demo/projects')).toBe('/demo/projects/*');
  // A leaf request still resolves its more specific param pattern.
  expect(match('/demo/projects/p1')).toBe('/demo/projects/:projectId');
});
```

In `loaders-handler.test.ts`, append inside `describe('loadersHandler bare-loader guarded-route dev warning', ...)` (reuse its `findGuardedRoute`, `bareWarnings`, `postBoard` helpers):

```ts
it('does not warn for a subtree binding and resolves guards from the declared wildcard', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const resolvePageUse = vi.fn(async () => []);
    const boundGlob = {
      './pages/board.server.ts': {
        __moduleKey: 'pages/board',
        serverLoaders: {
          default: serverRoute('/admin/*').loader(async () => ({ ok: true })),
        },
      },
    };
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(boundGlob, { dev: true, findGuardedRoute, resolvePageUse })
    );
    const res = await postBoard(app, '/admin/board');
    expect(res.status).toBe(200);
    expect(bareWarnings(warn.mock.calls)).toHaveLength(0);
    expect(resolvePageUse).toHaveBeenCalledWith('/admin/*');
  } finally {
    warn.mockRestore();
  }
});
```

Then add a new top-level describe at the end of `loaders-handler.test.ts` (add `defineRoutes`, `defineServerMiddleware` to the existing `@hono-preact/iso` import):

```ts
describe('subtree-bound loader chain (real manifest)', () => {
  const NullView = (): null => null;
  const noopView = async () => ({ default: NullView });
  const noopLayout = async () => ({ default: NullView });

  const makeApp = (
    gateImpl: (calls: string[]) => Parameters<typeof defineServerMiddleware>[0],
    calls: string[]
  ) => {
    const gate = defineServerMiddleware<'loader'>(gateImpl(calls));
    const m = defineRoutes([
      {
        path: '/shop',
        layout: noopLayout,
        use: [gate],
        children: [
          { path: '', view: noopView },
          { path: ':id', view: noopView },
        ],
      },
    ]);
    const byPattern = new Map(m.routeUse.map((r) => [r.path, r.use]));
    const glob = {
      './shop.server.ts': {
        __moduleKey: 'shop',
        serverLoaders: {
          shell: serverRoute('/shop/*').loader(async () => {
            calls.push('inner');
            return 'shell-data';
          }),
        },
      },
    };
    const app = new Hono();
    app.post(
      '/__loaders',
      loadersHandler(glob, {
        dev: true,
        resolvePageUse: (pattern) => byPattern.get(pattern) ?? [],
      })
    );
    return app;
  };

  const post = (app: Hono) =>
    app.request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'shop',
        loader: 'shell',
        location: { path: '/shop', pathParams: {}, searchParams: {} },
      }),
    });

  it('runs the subtree chain resolved from a defineRoutes manifest', async () => {
    const calls: string[] = [];
    const app = makeApp(
      (c) => async (_ctx, next) => {
        c.push('gate:before');
        await next();
        c.push('gate:after');
      },
      calls
    );
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(calls).toEqual(['gate:before', 'inner', 'gate:after']);
  });

  it('a deny in the subtree chain blocks the RPC (the loader never runs)', async () => {
    const calls: string[] = [];
    const app = makeApp(
      () => async () => {
        throw new Error('denied');
      },
      calls
    );
    const res = await post(app);
    expect(res.status).not.toBe(200);
    expect(calls).not.toContain('inner');
  });
});
```

Note: if `defineServerMiddleware`'s parameter typing rejects the `gateImpl` indirection, inline the two middleware definitions per test instead of sharing `makeApp`; the assertions are what matter.

- [ ] **Step 2: Run to verify (these should pass immediately; a failure here falsifies a spec assumption)**

Run: `pnpm vitest run packages/server/src/__tests__/route-pattern.test.ts packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/loaders-handler.test.ts 2>&1 | tail -8`
Expected: PASS. If the matcher test fails, the depth-tiebreak assumption is wrong: stop and re-read `findBestPattern` before touching the warning template.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/route-pattern.test.ts
git commit -m "test(server): pin subtree chain resolution and the wildcard warning suggestion

A serverRoute('<path>/*') loader RPC resolves the subtree chain from a
real defineRoutes manifest (runs, denies, and silences the bare-loader
warning), and findBestPattern's depth tiebreak makes the #263 warning
suggest the wildcard spelling for layout-location requests.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Dev aliasing diagnostic for exact layout-path bindings

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/route-binding-guard.ts` (add `warnAliasedLayoutBinding`)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/create-server-entry.ts` (wire `onAliasedBinding` in dev)
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/route-binding-guard.test.ts`
- Test: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/packages/server/src/__tests__/create-server-entry.test.ts`

**Interfaces:**
- Consumes: `RouteBindingCheckContext.onAliasedBinding` and `maybeReportAliasedBinding` (Task 3), `AliasedBindingInfo`.
- Produces: `export function warnAliasedLayoutBinding(warned: Set<string>, info: AliasedBindingInfo): void` (framework-private, consumed by `create-server-entry.ts`). Dev entries warn once per binding; prod passes no callback (zero cost).

- [ ] **Step 1: Write the failing tests**

In `route-binding-guard.test.ts` (add `vi` to the vitest import and `warnAliasedLayoutBinding`, `AliasedBindingInfo` to the guard import), append:

```ts
describe('aliasing diagnostic (onAliasedBinding)', () => {
  const g1 = () => {};
  const g2 = () => {};
  const collect = () => {
    const seen: AliasedBindingInfo[] = [];
    return { seen, cb: (info: AliasedBindingInfo) => seen.push(info) };
  };

  it('reports an exact binding whose sibling subtree chain differs', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [routeOf('/app', { __moduleKey: 'm', serverLoaders: { shell: bound('/app') } })],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([
      { kind: 'loader', name: 'shell', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });

  it('does not report when the two chains are identical', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [routeOf('/app', { __moduleKey: 'm', serverLoaders: { shell: bound('/app') } })],
      {
        routeUseByPattern: new Map([
          ['/app', [g1]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report a subtree binding (it IS the subtree scope)', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [routeOf('/app', { __moduleKey: 'm', serverLoaders: { shell: bound('/app/*') } })],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([]);
  });

  it('does not report when no sibling subtree key exists (leaf binding)', async () => {
    const { seen, cb } = collect();
    await assertRouteBindingsMatchMount(
      [routeOf('/leaf', { __moduleKey: 'm', serverLoaders: { l: bound('/leaf') } })],
      { routeUseByPattern: new Map([['/leaf', [g1]]]), onAliasedBinding: cb }
    );
    expect(seen).toEqual([]);
  });

  it('reports registry bindings through the same signal', async () => {
    const { seen, cb } = collect();
    await assertRegistryRouteBindingsValid(
      [
        async () => ({
          __moduleKey: 'src/server/x',
          serverActions: { save: bound('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: cb,
      }
    );
    expect(seen).toEqual([
      { kind: 'action', name: 'save', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });
});

describe('warnAliasedLayoutBinding', () => {
  it('warns once per binding key, naming both spellings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warned = new Set<string>();
      const info: AliasedBindingInfo = {
        kind: 'loader',
        name: 'shell',
        routeId: '/app',
        subtreeId: '/app/*',
      };
      warnAliasedLayoutBinding(warned, info);
      warnAliasedLayoutBinding(warned, info);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain("'/app'");
      expect(msg).toContain("serverRoute('/app/*')");
      expect(msg).toContain('page scope');
    } finally {
      warn.mockRestore();
    }
  });
});
```

In `create-server-entry.test.ts` (it already imports `vi`, `defineServerMiddleware`, `_defineRouteLoader`, `manifest`, `Layout`), append:

```ts
describe('aliased exact layout binding dev warning', () => {
  const buildApp = (dev: boolean) => {
    const layoutGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const indexGate = defineServerMiddleware<'loader'>(async (_c, next) =>
      next()
    );
    const loader = _defineRouteLoader('/x', async () => 'ok', {
      __moduleKey: 'test/m',
      __loaderName: 'l',
      use: [],
    });
    const mod = { __moduleKey: 'test/m', serverLoaders: { l: loader } };
    return createServerEntry({
      routes: manifest({
        serverImports: [async () => mod],
        serverRoutes: [{ path: '/x', server: async () => mod, ancestors: [] }],
        routeUse: [
          { path: '/x', use: [layoutGate, indexGate] },
          { path: '/x/*', use: [layoutGate] },
        ],
      }),
      layout: Layout,
      dev,
    });
  };
  const post = (app: ReturnType<typeof buildApp>) =>
    app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'test/m',
        loader: 'l',
        location: { path: '/x', pathParams: {}, searchParams: {} },
      }),
    });
  const aliasWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
    calls.filter((c) => String(c[0]).includes('page scope'));

  it('dev warns once per binding across requests, naming both spellings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(true);
      await post(app);
      await post(app);
      const warnings = aliasWarnings(warn.mock.calls);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0][0])).toContain("serverRoute('/x/*')");
    } finally {
      warn.mockRestore();
    }
  });

  it('prod never warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = buildApp(false);
      await post(app);
      expect(aliasWarnings(warn.mock.calls)).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/server/src/__tests__/route-binding-guard.test.ts packages/server/src/__tests__/create-server-entry.test.ts 2>&1 | tail -20`
Expected: FAIL. `warnAliasedLayoutBinding` is not exported, and the entry-level dev test finds 0 warnings (Task 3 threaded the context but wired no callback). The `onAliasedBinding` detection tests may already pass (Task 3 implemented `maybeReportAliasedBinding`); that is fine, they pin it.

- [ ] **Step 3: Implement**

In `route-binding-guard.ts`, add after `maybeReportAliasedBinding`:

```ts
/**
 * Dev-only console warning for an aliased exact-path binding, fired through
 * `RouteBindingCheckContext.onAliasedBinding`. One warning per binding key
 * for the life of the `warned` set the caller owns (the generated entry
 * re-runs boot checks per request in dev; the set dedups across runs).
 *
 * NOTE: framework-private. The only intended consumer is the generated
 * server entry.
 */
export function warnAliasedLayoutBinding(
  warned: Set<string>,
  info: AliasedBindingInfo
): void {
  const key = `${info.kind}:${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: ${info.kind} '${info.name}' is bound to '${info.routeId}', ` +
      `the page scope for that pattern: its RPC runs the deepest composed ` +
      `chain, which includes the index child's own 'use' on top of the ` +
      `layout's chain. For subtree-scoped (layout shell) data, bind ` +
      `serverRoute('${info.subtreeId}') instead: the subtree scope runs the ` +
      `layout node's own composed chain without the index child's additions. ` +
      `Keep '${info.routeId}' if this ${info.kind} should run the index ` +
      `page's full gate chain.`
  );
}
```

In `create-server-entry.ts`, extend the Task 3 block (add `warnAliasedLayoutBinding` to the guard import):

```ts
  // Dedup store for the dev aliasing warning: one per binding for the life
  // of this entry (boot checks re-run per request in dev).
  const warnedAliasedBindings = new Set<string>();
  const bindingCheckContext: RouteBindingCheckContext = {
    routeUseByPattern: new Map(routes.routeUse.map((r) => [r.path, r.use])),
    // Dev-only observational diagnostic: an exact-path binding whose sibling
    // subtree chain differs was widened by the index child's own `use`. Prod
    // passes no callback, so the detection short-circuits to zero cost.
    ...(dev
      ? {
          onAliasedBinding: (info: AliasedBindingInfo) =>
            warnAliasedLayoutBinding(warnedAliasedBindings, info),
        }
      : {}),
  };
```

(`AliasedBindingInfo` joins the type import from `'./route-binding-guard.js'`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/server/src/__tests__/route-binding-guard.test.ts packages/server/src/__tests__/create-server-entry.test.ts 2>&1 | tail -6`
Expected: PASS.

Run the full server suite for interaction fallout: `pnpm vitest run packages/server 2>&1 | tail -6`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-binding-guard.ts packages/server/src/create-server-entry.ts packages/server/src/__tests__/route-binding-guard.test.ts packages/server/src/__tests__/create-server-entry.test.ts
git commit -m "feat(server): dev warning for exact layout bindings aliased by the index child

When an exact-path binding's routeUse chain differs from its sibling
subtree entry (the index child declared its own use), the dev boot check
warns once per binding, naming the page-scope and subtree-scope spellings.
Prod wires no callback, so the diagnostic costs nothing at runtime.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Site exemplar: bind projects-shell to the subtree pattern

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/demo/projects-shell.server.ts` (lines 39-43)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts` (pins at lines 93 and 95, plus new tests)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/components/demo/__tests__/ActivityBar.ssr.test.tsx` (comment block at lines 82-88 and pin at line 90)

**Interfaces:**
- Consumes: `serverRoute('/demo/projects/*')` typing (Task 1), the `'/demo/projects/*'` routeUse key (Task 2), boot acceptance (Task 3). Requires fresh framework dist (built in Task 3 Step 4; rebuild if in doubt).
- Produces: the live exemplar the docs (Task 7) describe. `serverLoaders.default.__routeId === '/demo/projects/*'`.

- [ ] **Step 1: Update the test pins and add the new tests (failing first)**

In `projects-shell.server.test.ts`, change the two pins:

```ts
    expect(serverLoaders.default.__routeId).toBe('/demo/projects/*');
    expect(serverLoaders.default.__routeBound).toBe(true);
    expect(serverLoaders.activity.__routeId).toBe('/demo/projects/*');
    expect(serverLoaders.activity.__routeBound).toBe(true);
```

and update the describe's comment to say the binding is the subtree scope. Rename the describe to `'shell loaders are subtree-bound to the projects layout'` and the first it to `'binds default and activity to /demo/projects/*'`.

Add the imports `import routes from '../../../routes.js';` and `import { requireSession } from '../../../demo/guard.js';` and `import { serverRoute, buildPath } from 'hono-preact';` (merge with the existing `hono-preact` import), then append:

```ts
describe('the bound subtree pattern resolves the projects gates from the site manifest', () => {
  it('the bound pattern is a routeUse key carrying exactly the layout chain', () => {
    const byPattern = new Map(routes.routeUse.map((r) => [r.path, r.use]));
    // The seam the RPC guard resolution walks: declared pattern -> routeUse
    // key -> the projects layout's own composed chain (requireSession).
    expect(byPattern.get(serverLoaders.default.__routeId!)).toEqual(
      requireSession
    );
  });
});

// Type-level pins, enforced by `pnpm typecheck` (the site tsconfig includes
// test files). Never executed.
function _subtreeTypeProbes() {
  // The subtree spelling is typed for the projects layout.
  serverRoute('/demo/projects/*');
  // @ts-expect-error a leaf path derives no subtree pattern
  serverRoute('/demo/login/*');
  // @ts-expect-error the nav surface stays on exact registered paths
  buildPath('/demo/projects/*');
}
void _subtreeTypeProbes;
```

If `__routeId` is typed optional and the non-null `!` is rejected by lint conventions, read it into a local with an explicit narrowing check (`if (typeof id !== 'string') throw new Error('unbound')`) instead; do not cast.

In `ActivityBar.ssr.test.tsx`, update the pin and the comment block:

```tsx
// Route-binding contract: the activity loader is bound to the projects
// layout's SUBTREE pattern via serverRoute('/demo/projects/*'), so its RPC
// composes the layout node's own use chain (requireSession on the projects
// node in routes.ts) from the declared pattern. The layout host supplies the
// derived layout location to route-bound loaders consumed inside the layout,
// and { live: true } keeps the stream off the SSR path.
describe('ActivityBar: activity loader route-binding contract', () => {
  it('is bound to the projects layout subtree', () => {
    expect(serverLoaders.activity.__routeId).toBe('/demo/projects/*');
    expect(serverLoaders.activity.__routeBound).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts apps/site/src/components/demo/__tests__/ActivityBar.ssr.test.tsx 2>&1 | tail -12`
Expected: FAIL: pins expect `'/demo/projects/*'` but the module still binds `'/demo/projects'`.

- [ ] **Step 3: Move the exemplar to the subtree spelling**

In `projects-shell.server.ts`, replace lines 39-43 with:

```ts
// Bind this server module to the projects layout's subtree pattern. The
// subtree scope resolves the layout node's own composed use chain
// (requireSession, declared on the projects node in routes.ts) on every
// loader RPC, so the shell's data endpoints carry exactly the gates every
// child of /demo/projects inherits.
const route = serverRoute('/demo/projects/*');
```

- [ ] **Step 4: Run to verify pass, typecheck, and build the site**

Run: `pnpm vitest run apps/site/src 2>&1 | tail -6`
Expected: PASS (whole site suite: nothing else pinned the exact spelling; the `LOC` constant in ActivityBar tests is a location, not a binding).

Run: `pnpm typecheck && pnpm --filter site build`
Expected: both succeed (this also enforces the `@ts-expect-error` probes and proves `'/demo/projects/*'` is accepted by the registered union).

- [ ] **Step 5: Live verification (verify the URL, not just the emission)**

Start the dev server in the background: `pnpm --filter site dev` (port 5173).

```bash
# SSR gate still redirects an unauthenticated shell request:
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:5173/demo/projects
```
Expected: a 30x status with redirect to `/demo/login` (or the login HTML on a 200 if the redirect is followed internally; the point is no projects shell for an unauthenticated request).

```bash
# RPC gate: discover the moduleKey from the client stub, then hit /__loaders.
curl -s http://localhost:5173/src/pages/demo/projects-shell.server.ts | grep -o '__moduleKey\s*=\s*"[^"]*"'
curl -s -X POST http://localhost:5173/__loaders \
  -H 'Content-Type: application/json' \
  -d '{"module":"<moduleKey from above>","loader":"default","location":{"path":"/demo/projects","pathParams":{},"searchParams":{}}}'
```
Expected: a redirect/deny envelope mentioning `/demo/login`; the body must NOT contain a `projects` array. If the stub URL does not serve, obtain the moduleKey from the browser network tab of `/demo/projects` instead. Stop the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/demo/projects-shell.server.ts apps/site/src/pages/demo/__tests__/projects-shell.server.test.ts apps/site/src/components/demo/__tests__/ActivityBar.ssr.test.tsx
git commit -m "feat(site): bind projects-shell loaders to the /demo/projects subtree

The layout's loaders are subtree-scoped shell data, so the wildcard is the
semantically right spelling: it resolves the projects node's own composed
chain (requireSession) rather than the index child's page scope. Pins move
to the wildcard and a manifest-seam test asserts the bound pattern is a
routeUse key carrying exactly the layout chain.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Docs: teach the two spellings on the pages this branch touched

**Files:**
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/docs/loaders.mdx` (the `serverRoute('/movies')` snippet around line 375 and the `### Binding a layout's loaders` section)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/docs/middleware.mdx` (the two paragraphs after the bare-units paragraph)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/docs/routes.mdx` (the registry bindability paragraph, line ~107)
- Modify: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder/apps/site/src/pages/docs/live-loaders.mdx` (the `serverRoute('/demo/projects')` snippet)

Docs rules: describe what IS. No history. No em-dashes. CSS/Tailwind parity is untouched (no styled snippets here).

- [ ] **Step 1: loaders.mdx**

In the layout streaming example (around line 375), change:

```ts
const route = serverRoute('/movies');
```

to:

```ts
// Subtree scope: the gates every /movies child inherits.
const route = serverRoute('/movies/*');
```

Replace the ENTIRE `### Binding a layout's loaders` section body (the two paragraphs added by this branch) with:

```md
### Binding a layout's loaders

A layout server module has two bindable spellings, and they name different scopes:

- `serverRoute('/movies')` is the **page scope**: the deepest composed chain for that pattern string. A layout and its empty-path index child share the string, and guard resolution uses the deepest node's chain, so this spelling runs the layout's inherited and own `use` plus the index child's own `use` when the index child declares one. Bind it when the module's units belong to the index page.
- `serverRoute('/movies/*')` is the **subtree scope**: the layout node's own composed chain (ancestors outer-first, then the node's own `use`), exactly the gates every descendant of `/movies` inherits. The index child's additions are not included. Bind it when the module carries shell data that serves every child route, which is the usual case for a layout module.

Both spellings resolve the `use` chain from the declared pattern on every loader RPC, never from the request URL. The subtree pattern names the tree node at `/movies` and resolves its chain statically at startup; it is not a per-request deepest-match. A subtree pattern on a childless route fails loudly at startup.

Inside the layout, a bound loader resolves its `location` to the layout's own matched path with the wildcard remainder stripped, so `ctx.location.pathParams` carries exactly the bound pattern's prefix params under either spelling.

In dev, binding the exact path while the index child's own `use` widens the chain logs a one-time hint naming both spellings.
```

- [ ] **Step 2: middleware.mdx**

Replace the paragraph beginning `A layout node's path is a route pattern too, so a layout's own server module binds the same way: ...` with:

```md
A layout's own server module binds either scope of its node. `serverRoute('/admin/*')` is the subtree scope: the chain every descendant inherits (the layout's inherited and own `use`), the usual spelling for shell data. `serverRoute('/admin')` is the page scope: the deepest composed chain for the pattern string, which adds the index child's own `use` when the index child declares one (see [Binding a layout's loaders](/docs/loaders#binding-a-layouts-loaders)).
```

Replace the paragraph beginning `A grouping node that declares `use` and `children` but no `view` or `layout` has no pattern of its own, so nothing binds to it directly. ...` with:

```md
A grouping node that declares `use` and `children` but no `view` or `layout` has no page pattern of its own, but its subtree does: a server module shared across the subtree binds `serverRoute('/x/*')` and runs the composed chain the node passes to every descendant.
```

- [ ] **Step 3: routes.mdx**

Replace the sentence run starting `The bound pattern must be a real route in your table; ...` (through `... The folder is configurable via the Vite plugin's `serverDir` option (default `src/server`).`) with:

```md
The bound pattern must be a real route in your table; a `serverRoute('/typo')` that matches no route fails loudly at startup rather than running under no gates. Any node with child routes (a layout, or a grouping node that declares only `use` and `children`) is bindable as a subtree: `serverRoute('/demo/projects/*')` resolves the chain every descendant inherits. A layout's exact path is also bindable when the layout has an index child or a server module of its own; that spelling is the page scope, the pattern's deepest composed chain. A subtree pattern on a childless route fails loudly at startup. The folder is configurable via the Vite plugin's `serverDir` option (default `src/server`).
```

- [ ] **Step 4: live-loaders.mdx**

Change the snippet comment and pattern:

```ts
// The projects route node declares `use: requireSession`; the subtree
// binding resolves that gate for the shell's loader RPCs from this
// declared pattern.
const route = serverRoute('/demo/projects/*');
```

- [ ] **Step 5: Regenerate the corpus, format, verify**

Run: `pnpm gen:agents-corpus && pnpm format:check`
Expected: corpus regenerates; format clean (run `pnpm format` and re-check if not).

Run: `pnpm --filter site build && pnpm vitest run apps/site 2>&1 | tail -4`
Expected: PASS (MDX compiles; no site test reads these strings).

Self-check: `rg -n '—' apps/site/src/pages/docs/loaders.mdx apps/site/src/pages/docs/middleware.mdx apps/site/src/pages/docs/routes.mdx apps/site/src/pages/docs/live-loaders.mdx`
Expected: no matches in the text you added (pre-existing hits elsewhere in the files, if any, stay).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/docs/loaders.mdx apps/site/src/pages/docs/middleware.mdx apps/site/src/pages/docs/routes.mdx apps/site/src/pages/docs/live-loaders.mdx
git commit -m "docs(site): teach the page and subtree binding scopes

Exact path = page scope (the pattern's deepest composed chain, index child
included); path/* = subtree scope (the layout node's own chain). The
grouping-prefix guidance now uses the first-class subtree binder, and the
demo snippets bind the wildcard the exemplar ships.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: CI-parity verification (the eight steps)

**Files:** none (verification only; commit only if `pnpm format` changes files).

- [ ] **Step 1: Run the eight steps in CI order, watching each complete**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: every step exits 0. If `format:check` fails, run `pnpm format`, commit the result as `style: format` (with the trailer), and restart from step 3.

- [ ] **Step 2: Push (append-only, no force) to update PR #267**

Only after all eight steps pass in a single sequence you watched:

```bash
git push origin dx/260-binder
```

Then note in the PR that the wildcard binder, aliasing diagnostic, exemplar migration, and docs revision landed, superseding the interim exact-path exemplar.

---

## Self-review notes (already applied)

- Spec coverage: scope items 1-8 map to Tasks 1, 2, 3, 4 (item 4), 5, 6, 7, 8 respectively. The spec's testing-strategy items 1-6 map to Task 2 tests (item 1), Task 3 tests (item 2), Task 4 tests (items 3 and 6), Task 1 test-d plus Task 6 probes (item 4), Task 6 (item 5).
- Deviation from the spec, deliberate: the asserts take a `routeUseByPattern` Map (not the spec's `validRoutePatterns` Set) because the aliasing diagnostic needs the chains and the Map's keys subsume the Set; one context object serves both with no extra plumbing.
- Type consistency: `subtreePatternOf` (iso, Tasks 2/3/5), `RouteBindingCheckContext` / `AliasedBindingInfo` / `warnAliasedLayoutBinding` (server, Tasks 3/5), `SubtreePatterns` / `RegisteredSubtrees` (iso, Tasks 1/6) are named identically everywhere they appear.
- Known accepted holes (documented, all fail-closed or fail-compile): grouping-node prefixes are runtime-bindable but not typed (their paths are not in `RegisteredPaths`); a layout whose only child is the index derives no typed wildcard though the runtime key exists; sibling shadowing can type a wildcard that boot rejects (e.g. `/*` when `/` is a view). None weakens a gate.
