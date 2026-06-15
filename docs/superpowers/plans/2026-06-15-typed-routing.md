# Typed Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active-state matching (`useRouteMatch`/`useRouteActive`/`NavLink.match`) autocomplete and typecheck against the registered route table, return route-typed params, and add a `buildPath(pattern, params)` helper for typed dynamic links.

**Architecture:** Reuse the existing type-level union `RegisteredPaths` and `RouteParams<P>` (in `packages/iso/src/internal/typed-routes.ts`). No new type machinery. `RegisteredPaths` is augmentation-scoped: it is `string` when the framework itself compiles (so internal callers and unit tests are unaffected) and the strict route union only in apps that register a tree. Type guarantees are proven by compile-time assertions in `apps/site` (the only place the augmentation is visible).

**Tech Stack:** TypeScript, Preact, preact-iso, Vitest, pnpm workspace.

**Branch:** `feat/typed-route-active` (already checked out; spec at `docs/superpowers/specs/2026-06-15-typed-route-active-design.md`).

> **As-built amendment (2026-06-15):** the matching hooks shipped **permissive** rather than strict. A `RoutePattern = RegisteredPaths | (string & {})` type was added to `typed-routes.ts`, and `useRouteMatch`/`useRouteActive`/`NavLink.match` take `RoutePattern` (autocomplete registered routes, accept any string) because content-glob routes are not in `RegisteredPaths`. `DocsLayout.tsx` keeps `useRouteActive('/docs/components', …)` (no `startsWith` workaround). The "rejects bogus route" assertions in Task 3 were replaced with positive "accepts any path" assertions (`routeActiveAcceptsAnyPath`); the typed-return and strict-`buildPath` assertions are unchanged. See commit `cf1a283`.

---

## File Structure

- `packages/iso/src/build-path.ts` **(new)** — the `buildPath` helper and its `BuildArgs` conditional-args type. One responsibility: turn a route pattern + params into a concrete path string.
- `packages/iso/src/route-active.ts` **(modify)** — `useRouteMatch` becomes generic with a typed return; `useRouteActive` takes `RegisteredPaths`. `matchPath` is untouched (internal, fed runtime strings).
- `packages/iso/src/nav-link.tsx` **(modify)** — `match?: RegisteredPaths`.
- `packages/iso/src/index.ts` **(modify)** — export `buildPath`.
- `packages/iso/src/__tests__/build-path.test.ts` **(new)** — behavioral tests for `buildPath`.
- `packages/iso/src/__tests__/public-exports.test.ts` **(modify)** — assert `buildPath` is exported.
- `apps/site/src/typed-route-params.assert.ts` **(modify)** — compile-time assertions for the hooks, `NavLink.match`, and `buildPath`.
- `apps/site/src/pages/demo/projects.tsx` **(modify)** — dogfood: build the dynamic href via `buildPath`.

**Key sequencing fact:** `pnpm typecheck` runs `tsc` per package, and `apps/site` resolves `hono-preact` through its built `dist/`. So any change to `packages/iso` is invisible to `apps/site` until the framework `dist/` is rebuilt. Tasks 1-2 verify against the iso package directly (source, no dist). Task 3 deliberately uses this: it adds the assertions, observes them FAIL against the stale dist (red), rebuilds dist, then observes PASS (green). **Do not run `pnpm build` during Tasks 1-2**, or you will spoil Task 3's red phase.

---

## Task 1: `buildPath` helper

**Files:**
- Create: `packages/iso/src/build-path.ts`
- Create: `packages/iso/src/__tests__/build-path.test.ts`
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/__tests__/public-exports.test.ts`

- [ ] **Step 1: Write the failing behavioral test**

Create `packages/iso/src/__tests__/build-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPath } from '../build-path.js';

describe('buildPath', () => {
  it('substitutes a single param', () => {
    expect(buildPath('/posts/:id', { id: '123' })).toBe('/posts/123');
  });

  it('substitutes multiple params', () => {
    expect(
      buildPath('/demo/projects/:projectId/issues/:issueId', {
        projectId: 'p1',
        issueId: 'i9',
      })
    ).toBe('/demo/projects/p1/issues/i9');
  });

  it('needs no params object for a param-less route', () => {
    expect(buildPath('/docs/components')).toBe('/docs/components');
  });

  it('keeps an optional param when provided', () => {
    expect(buildPath('/files/:id?', { id: 'x' })).toBe('/files/x');
  });

  it('drops an absent optional param segment', () => {
    expect(buildPath('/files/:id?', {})).toBe('/files');
  });

  it('percent-encodes substituted values', () => {
    expect(buildPath('/search/:q', { q: 'a b/c' })).toBe('/search/a%20b%2Fc');
  });

  it('returns the root path unchanged', () => {
    expect(buildPath('/')).toBe('/');
  });
});
```

- [ ] **Step 2: Add the export assertion to `public-exports.test.ts`**

In `packages/iso/src/__tests__/public-exports.test.ts`, inside the existing `describe('active-route detection exports', ...)` block (it already tests `useRouteMatch`/`useRouteActive`/`NavLink`), add:

```ts
  it('exports buildPath', () => {
    expect(typeof iso.buildPath).toBe('function');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/iso/src/__tests__/build-path.test.ts packages/iso/src/__tests__/public-exports.test.ts`
Expected: FAIL — `build-path.test.ts` cannot resolve `../build-path.js`, and `iso.buildPath` is `undefined`.

- [ ] **Step 4: Create the implementation**

Create `packages/iso/src/build-path.ts`:

```ts
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';

// Param-less routes take no second argument; routes with params require the
// matching params object. `keyof {} extends never` is true, so param-less
// patterns resolve to the empty tuple.
type BuildArgs<P extends string> =
  keyof RouteParams<P> extends never ? [] : [params: RouteParams<P>];

/**
 * Build a concrete path from a registered route pattern and its params.
 *
 *   buildPath('/demo/projects/:projectId', { projectId: p.slug }) // '/demo/projects/abc'
 *   buildPath('/docs/components')                                 // '/docs/components'
 */
// Public, type-safe overload. The implementation signature below is the
// standard typed-overload idiom: it is intentionally looser and never visible
// to callers, so the body reads dynamic keys off a plain Record without a cast.
export function buildPath<P extends RegisteredPaths>(
  pattern: P,
  ...args: BuildArgs<P>
): string;
export function buildPath(
  pattern: string,
  params?: Record<string, string | undefined>
): string {
  const values = params ?? {};
  return pattern
    .split('/')
    .map((seg) => {
      const m = /^:([A-Za-z0-9_]+)[?*+]?$/.exec(seg);
      if (!m) return seg; // static segment, kept verbatim
      const value = values[m[1]];
      // Absent → drop the segment (the type requires every non-optional param,
      // so an absent value here can only be an optional one).
      return value == null ? null : encodeURIComponent(value);
    })
    .filter((seg) => seg !== null)
    .join('/');
}
```

- [ ] **Step 5: Export `buildPath` from the package barrel**

In `packages/iso/src/index.ts`, add (placement near the other route/navigation exports is fine):

```ts
export { buildPath } from './build-path.js';
```

The `hono-preact` umbrella re-exports via `export * from '@hono-preact/iso'`, so no umbrella edit is needed.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/iso/src/__tests__/build-path.test.ts packages/iso/src/__tests__/public-exports.test.ts`
Expected: PASS (all 8 `buildPath` cases + the export check).

- [ ] **Step 7: Typecheck the iso package**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: PASS. (This proves the overload signature and the literal-driven `BuildArgs<P>` typecheck, including the test file's calls.)

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/build-path.ts packages/iso/src/index.ts packages/iso/src/__tests__/build-path.test.ts packages/iso/src/__tests__/public-exports.test.ts
git commit -m "$(cat <<'EOF'
feat(iso): add typed buildPath helper for dynamic links

buildPath(pattern, params) interpolates a registered route pattern into
a concrete path. The pattern autocompletes from RegisteredPaths and the
params are enforced by RouteParams<pattern> (omitted for param-less
routes via a conditional rest arg). Overload pair keeps the impl
cast-free.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Typed active-state matching (`route-active.ts` + `nav-link.tsx`)

This is a type-only change: the runtime behavior of all three functions is unchanged, so there is no new in-package failing test. The strictness and typed return are not observable inside `packages/iso` (where `RegisteredPaths` is `string`); they are proven against the registered route tree in Task 3. In-package verification here is **regression** (existing tests stay green) plus **the package still typechecks**.

**Files:**
- Modify: `packages/iso/src/route-active.ts`
- Modify: `packages/iso/src/nav-link.tsx`

- [ ] **Step 1: Add the type import to `route-active.ts`**

At the top of `packages/iso/src/route-active.ts`, after the existing `import { useLocation, exec } from 'preact-iso';` line, add:

```ts
import type { RegisteredPaths, RouteParams } from './internal/typed-routes.js';
```

- [ ] **Step 2: Make `useRouteMatch` generic with a typed return**

Replace the existing `useRouteMatch` function with:

```ts
export function useRouteMatch<R extends RegisteredPaths>(
  route: R,
  options?: RouteMatchOptions
): RouteParams<R> | null {
  const { path } = useLocation();
  return matchPath(path, route, options?.exact ?? true) as RouteParams<R> | null;
}
```

The single `as RouteParams<R> | null` cast is at the `matchPath` boundary (it returns `Record<string, string> | null`); this mirrors the accepted cast in `use-params.ts` (`useRoute().pathParams as RouteParams<P>`), where preact-iso's untyped match output acquires its compile-time shape.

- [ ] **Step 3: Constrain `useRouteActive`'s input**

Replace the existing `useRouteActive` function with:

```ts
export function useRouteActive(
  route: RegisteredPaths,
  options?: RouteMatchOptions
): boolean {
  return useRouteMatch(route, options) !== null;
}
```

Leave `matchPath`, `execParams`, and `RouteMatchOptions` exactly as they are.

- [ ] **Step 4: Type `NavLink.match`**

In `packages/iso/src/nav-link.tsx`, add the type import after the existing `import { useRouteActive } from './route-active.js';`:

```ts
import type { RegisteredPaths } from './internal/typed-routes.js';
```

Then change the `match` prop in `NavLinkProps` from:

```ts
  /** Pattern to test for active state. Defaults to `href`. */
  match?: string;
```

to:

```ts
  /** Pattern to test for active state. Defaults to `href`. */
  match?: RegisteredPaths;
```

Leave `href: string` unchanged (it is a concrete destination, not a pattern). The internal `useRouteActive(match ?? href, { exact })` still compiles because, in the framework build, `RegisteredPaths` is `string`.

- [ ] **Step 5: Run the active-route tests (regression)**

Run: `pnpm exec vitest run packages/iso/src/__tests__/route-active.test.tsx`
Expected: PASS — runtime is unchanged. (The `Probe` harness passes a `string` route, which is valid since `RegisteredPaths` is `string` in the iso build.)

- [ ] **Step 6: Typecheck the iso package**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: PASS. (Confirms the generic, the cast, and the `NavLink.match` change all typecheck against the in-package `RegisteredPaths = string`.)

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/route-active.ts packages/iso/src/nav-link.tsx
git commit -m "$(cat <<'EOF'
feat(iso): type route-active hooks against the route table

useRouteMatch is now generic over RegisteredPaths and returns
RouteParams<route> | null; useRouteActive takes RegisteredPaths;
NavLink.match takes RegisteredPaths. matchPath stays internal and
untyped. Runtime behavior is unchanged; strictness is augmentation-
scoped so the framework build is unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Prove the type guarantees in `apps/site` + dogfood

This task proves the strictness, typed return, `NavLink.match`, and `buildPath` types against the real registered route tree, and migrates the one hand-built dynamic href. The red→green signal comes from the stale framework `dist/`: the assertions fail against the old dist, then pass after a rebuild. This doubles as proof the assertions are load-bearing.

**Files:**
- Modify: `apps/site/src/typed-route-params.assert.ts`
- Modify: `apps/site/src/pages/demo/projects.tsx`

- [ ] **Step 1: Add the compile-time assertions**

In `apps/site/src/typed-route-params.assert.ts`:

First, extend the import on line 4 and the type-only import on line 5:

```ts
import { useParams, useRouteMatch, useRouteActive, buildPath } from 'hono-preact';
import type { RoutePaths, RouteParams, NavLinkProps } from 'hono-preact';
```

Add this helper above the `_TypedRouteParamAssertions` tuple (it is never executed; the file is not imported anywhere):

```ts
// useRouteMatch projects the route's typed params, not Record<string, string>.
function useRouteMatchReturn() {
  return useRouteMatch('/demo/projects/:projectId');
}
```

Add these entries to the end of the `_TypedRouteParamAssertions` tuple (before the closing `];`):

```ts
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
```

Add these assertion functions below the existing `useRegistrationReachesIso` function:

```ts
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
```

- [ ] **Step 2: Dogfood `buildPath` in the projects page**

In `apps/site/src/pages/demo/projects.tsx`, add `buildPath` to the existing named import from `'hono-preact'` (the import that brings in `ViewTransitionName`). Then change the anchor href from:

```tsx
                  href={`/demo/projects/${p.slug}`}
```

to:

```tsx
                  href={buildPath('/demo/projects/:projectId', { projectId: p.slug })}
```

- [ ] **Step 3: Observe the RED typecheck (against the stale dist)**

Do NOT rebuild dist yet. Run: `pnpm typecheck`
Expected: FAIL in the `site` package. The stale `hono-preact` dist still exports the old signatures, so you should see errors such as: `buildPath` has no exported member; `useRouteMatch('/demo/projects/:projectId')`'s return is `Record<string, string> | null` (the `Equal<...>` assertion fails); the two `@ts-expect-error` directives on `useRouteActive`/`useRouteMatch('/not/a/route')` are reported as unused (old `route: string` accepts any string); and the bogus-`NavLink.match` assertion fails (old `match: string`).

(If `pnpm typecheck` instead reports the iso package's own checks as failing, you skipped a step in Task 1 or 2 — fix that first.)

- [ ] **Step 4: Rebuild the framework dist**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: builds succeed; `hono-preact` dist now exports `buildPath` and the typed signatures.

- [ ] **Step 5: Observe the GREEN typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages. Every assertion now holds, the `@ts-expect-error` directives each suppress a real error, and the dogfooded `buildPath` call typechecks against the live route augmentation.

- [ ] **Step 6: Run the full unit suite (cross-package regression)**

Run: `pnpm test`
Expected: PASS. (A cross-package check; the iso public-API change must not break any consumer test.)

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/typed-route-params.assert.ts apps/site/src/pages/demo/projects.tsx
git commit -m "$(cat <<'EOF'
test(site): assert typed route-active + buildPath; dogfood buildPath

Compile-time assertions prove useRouteMatch's typed return, strict route
rejection on both hooks, NavLink.match acceptance/rejection, and
buildPath's param enforcement against the real site route tree. The
projects page builds its dynamic href via buildPath.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full pre-push verification gate

Mirror CI locally (`.github/workflows/ci.yml`) in the same order, so nothing is left for CI to catch. `pnpm format:check` is the step most often forgotten.

**Files:** none (verification only; commit only if `pnpm format` changes files).

- [ ] **Step 1: Rebuild framework dist (idempotent; ensures a clean baseline)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: PASS.

- [ ] **Step 2: Format**

Run: `pnpm format` then `pnpm format:check`
Expected: `format:check` reports all matched files use Prettier code style. If `pnpm format` changed any file, commit it:

```bash
git add -A
git commit -m "$(cat <<'EOF'
style: prettier formatting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Unit tests with coverage**

Run: `pnpm test:coverage`
Expected: PASS.

- [ ] **Step 5: Integration tests**

Run: `pnpm test:integration`
Expected: PASS. (Note: the scaffolder integration test needs network access; if it hangs or flakes offline, that is environmental, not a regression in this change. Re-run with network available.)

- [ ] **Step 6: Site build**

Run: `pnpm --filter site build`
Expected: PASS.

- [ ] **Step 7: Final working-tree check**

Run: `git status`
Expected: clean (every change committed; no format-dirty files left behind by per-task commits).

---

## Self-Review

**Spec coverage:**
- Part A — `useRouteMatch` strict input + typed return: Task 2 Step 2; proven Task 3 Steps 1/5. ✓
- Part A — `useRouteActive` strict input: Task 2 Step 3; proven Task 3. ✓
- Part A — `matchPath` unchanged: Task 2 Step 3 note ("Leave `matchPath` ... exactly as they are"). ✓
- Part A — `NavLink.match`: Task 2 Step 4; proven Task 3 tuple assertions. ✓
- Part B — `buildPath` helper + `BuildArgs`: Task 1 Step 4. ✓
- Part B — export: Task 1 Step 5. ✓
- Testing — `route-active.test.tsx` unchanged: Task 2 Step 5 (regression). ✓
- Testing — new `build-path.test.ts`: Task 1 Step 1 (all listed cases: required, multi, param-less, optional present/absent, encoding, root). ✓
- Testing — apps/site type assertions (typed return, registered accepted / bogus rejected, NavLink.match, buildPath): Task 3 Step 1. ✓
- Dogfood — `projects.tsx`: Task 3 Step 2. ✓
- Migration — call sites compile under strict mode (`DocsLayout.tsx:38`): covered by Task 3 Step 5 `pnpm typecheck` over the whole site (it typechecks every call site, not just the assert file). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step gives an exact command and expected result. ✓

**Type consistency:** `RegisteredPaths` / `RouteParams` / `BuildArgs` names and the `useRouteMatch<R>` / `useRouteActive(route: RegisteredPaths)` / `buildPath<P>` signatures are identical across Tasks 1-3 and the assertions. The dogfood param name `projectId` matches the route tree (`routes.ts:46`) and the assertion. ✓
