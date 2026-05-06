# Iso Surface Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `@hono-preact/iso`'s public surface from ~30 names to ~17 by deleting the custom `Route`/`Router`/`wrapWithPage`/`PAGE_BINDINGS` orchestration layer, making `definePage` self-wrap in `<Page>`, re-exporting `Route`/`Router`/`lazy` from `preact-iso`, and demoting granular composition pieces to a `@hono-preact/iso/internal` subpath.

**Architecture:** `definePage(Component, bindings)` becomes a small HOC that returns a routable component `(location) => <Page bindings location={location}><Component/></Page>` instead of stamping a `PAGE_BINDINGS` symbol that the custom `<Route>` later reads. Routing primitives (`Route`, `Router`, `lazy`) become trivial re-exports of `preact-iso`'s versions; consumers don't have to know the import path changed. Granular composition pieces (`Loader`, `Envelope`, `RouteBoundary`, `Guards`, `GuardGate`, `OptimisticOverlay`, contexts, SSR helpers) move behind a `/internal` subpath for advanced use; the front door is the `Page` escape hatch plus `definePage`. The route-level props (`fallback`, `errorFallback`, `serverGuards`, `clientGuards`) move into `PageBindings` so all per-page concerns live with the page component.

**Tech Stack:** TypeScript, Preact, preact-iso, Vite plugin API, vitest.

**Companion to:** `docs/superpowers/research/2026-05-04-framework-simplification.md` (especially §3, §5, §6, §7, §9 steps 2-6).

**Builds on:** `docs/superpowers/plans/2026-05-05-path-keyed-module-identity.md` (Plan A, merged in PR #8).

---

## File Structure

### Modified files

- `packages/iso/src/define-page.ts` — `PageBindings` widens to include route-level props (`fallback`, `errorFallback`, `serverGuards`, `clientGuards`). `definePage(Component, bindings)` returns a self-wrapping `(location: RouteHook) => JSX.Element` component instead of stamping `PAGE_BINDINGS`. The symbol export and the `PageComponent` type are removed.
- `packages/iso/src/index.ts` — drops `Route`, `Router`, `wrapWithPage`, `PAGE_BINDINGS`, `PageBindings` (re-exported), `PageComponent`, `RouteProps`, `RouterProps`, `RouteConfig`, `PageConfig` (and `lazy` becomes a re-export of preact-iso). Adds re-exports of `Route`, `Router`, `lazy` from `preact-iso`. Drops re-exports of `Loader`, `Envelope`, `RouteBoundary`, `Guards`, `GuardGate`, `useGuardResult`, `OptimisticOverlay`, all four context objects, `getPreloadedData`, `deletePreloadedData`, `runRequestScope`, `wrapPromise`, `runGuards` — those move to `/internal`.
- `packages/iso/package.json` — adds `exports['./internal']` pointing at the new internal entry.
- `apps/app/src/iso.tsx` — drops the `IsoRoute` workaround import and the multi-line comment explaining it. All routes use `Route` from `@hono-preact/iso` (which is now a re-export of `preact-iso`'s `Route`). The `<Route path="/watched" fallback={...}>` prop moves into the page module's `definePage` bindings.
- `apps/app/src/pages/watched.tsx` — `definePage` call gains a `fallback` binding.
- Various test files in `packages/iso/src/__tests__/` — `route.test.tsx` is deleted; `define-page.test.ts` updates to assert the new self-wrapping behavior; `page.test.tsx` may need minor adjustments to use the new shape.

### Created files

- `packages/iso/src/internal.ts` — re-exports the demoted granular pieces. Single responsibility: present a typed surface for advanced consumers without putting these names on the package's front door.
- `packages/iso/src/__tests__/internal.test.ts` — sanity test that the internal subpath re-exports the expected names.

### Deleted files

- `packages/iso/src/route.tsx` (~194 lines) — the custom `Route`/`Router`/`wrapWithPage` is gone; preact-iso's primitives are sufficient now that `definePage` self-wraps.
- `packages/iso/src/lazy.ts` (~49 lines) — the custom wrapped `lazy` exposing `getResolvedDefault()` is gone; preact-iso's `lazy` is sufficient when `definePage` no longer needs introspection.
- `packages/iso/src/__tests__/route.test.tsx` — covered the deleted `route.tsx`.
- `packages/iso/src/__tests__/lazy.test.tsx` — covered the deleted `lazy.ts`.

---

## Task 1: Widen `PageBindings` to include route-level props

**Files:**
- Modify: `packages/iso/src/define-page.ts`
- Modify: `packages/iso/src/__tests__/define-page.test.ts`

The existing `PageBindings` type covers `loader`, `cache`, `Wrapper`. The route-level props (`fallback`, `errorFallback`, `serverGuards`, `clientGuards`) live on the custom `<Route>` today. This task widens `PageBindings` so they can move to `definePage`. The `definePage` runtime is unchanged in this task; it still stamps `PAGE_BINDINGS`.

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/define-page.test.ts`:

```ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import { definePage, type PageBindings } from '../define-page.js';
import type { GuardFn } from '../guard.js';

describe('PageBindings widened surface', () => {
  it('accepts fallback, errorFallback, serverGuards, clientGuards on the bindings type', () => {
    const guard: GuardFn = async () => null;
    const bindings: PageBindings<{ ok: true }> = {
      fallback: <p>loading</p>,
      errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
      serverGuards: [guard],
      clientGuards: [guard],
    };
    expectTypeOf(bindings.fallback).toEqualTypeOf<JSX.Element | undefined>();
    expectTypeOf(bindings.errorFallback).toMatchTypeOf<
      JSX.Element | ((error: Error, reset: () => void) => JSX.Element) | undefined
    >();
    expectTypeOf(bindings.serverGuards).toEqualTypeOf<GuardFn[] | undefined>();
    expectTypeOf(bindings.clientGuards).toEqualTypeOf<GuardFn[] | undefined>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/iso/src/__tests__/define-page.test.ts`

Expected: type errors on the new fields.

- [ ] **Step 3: Widen the type**

Update `packages/iso/src/define-page.ts`. Replace the `PageBindings` type:

```ts
import type { ComponentType, JSX } from 'preact';
import type { LoaderRef } from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import type { WrapperProps } from './page.js';

export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};
```

(The runtime function `definePage` is unchanged in this task — it still stamps the symbol on the component.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/iso/src/__tests__/define-page.test.ts`

Expected: PASS — new test passes, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-page.ts packages/iso/src/__tests__/define-page.test.ts
git commit -m "feat(iso): widen PageBindings to include route-level props"
```

---

## Task 2: Migrate `apps/app/src/pages/watched.tsx` fallback into `definePage`

**Files:**
- Modify: `apps/app/src/pages/watched.tsx`
- Modify: `apps/app/src/iso.tsx`

This is the only page in the app that uses a route-level `fallback`. Move it into `definePage` bindings now (Task 1 widened the type) so Task 3 can delete the route-level prop without losing behavior.

- [ ] **Step 1: Read both files to confirm context**

Read `apps/app/src/iso.tsx` and `apps/app/src/pages/watched.tsx`. Confirm:
- `iso.tsx` has `<Route path="/watched" component={Watched} fallback={<p class="p-1">Loading watched list…</p>}>`.
- `watched.tsx` ends with `export default definePage(WatchedPage, { loader, cache });`.

- [ ] **Step 2: Move the fallback**

In `apps/app/src/pages/watched.tsx`, change the `definePage` call:

```diff
-export default definePage(WatchedPage, { loader, cache });
+export default definePage(WatchedPage, {
+  loader,
+  cache,
+  fallback: <p class="p-1">Loading watched list…</p>,
+});
```

In `apps/app/src/iso.tsx`, drop the `fallback` prop:

```diff
-      <Route
-        path="/watched"
-        component={Watched}
-        fallback={<p class="p-1">Loading watched list…</p>}
-      />
+      <Route path="/watched" component={Watched} />
```

- [ ] **Step 3: Run tests to confirm no regression**

Run: `pnpm test`

Expected: all tests green. (The custom `<Route>` still reads the bindings and passes them to `<Page>`, including the new `fallback` binding — see `packages/iso/src/route.tsx`'s `PageBoundary` component.)

- [ ] **Step 4: Smoke test the running app**

Run `pnpm dev` in the background, visit `http://localhost:5173/watched`, confirm the loading state appears briefly. Kill the server.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/watched.tsx apps/app/src/iso.tsx
git commit -m "refactor(app): move /watched route-level fallback into definePage bindings"
```

---

## Task 3: Make `definePage` self-wrap in `<Page>` and delete the custom `Route`/`Router`/`lazy`

**Files:**
- Modify: `packages/iso/src/define-page.ts` (rewrite)
- Modify: `packages/iso/src/index.ts` (drop deleted exports, add re-exports of preact-iso)
- Modify: `packages/iso/src/__tests__/define-page.test.ts` (update for self-wrapping behavior)
- Modify: `apps/app/src/iso.tsx` (drop the `IsoRoute` workaround)
- Delete: `packages/iso/src/route.tsx`
- Delete: `packages/iso/src/lazy.ts`
- Delete: `packages/iso/src/__tests__/route.test.tsx`
- Delete: `packages/iso/src/__tests__/lazy.test.tsx`

This is the single most impactful task in the plan. After this commit:
- `definePage` returns a routable function `(location: RouteHook) => JSX.Element` instead of stamping a symbol.
- `Route`, `Router`, and `lazy` are imported by consumers from `@hono-preact/iso` but are trivial re-exports of `preact-iso`'s versions.
- `apps/app/src/iso.tsx` drops the `IsoRoute` workaround entirely.
- The custom `route.tsx` and `lazy.ts` source files are deleted.

The change must be atomic: if `definePage` self-wraps but the old `<Route>` still wraps with `wrapWithPage`, every page would render `<Page>` twice (once from the route handler, once from the page component), which causes the loader to fire twice and the SSR `data-loader` attribute to nest.

- [ ] **Step 1: Rewrite the `definePage` test for self-wrapping behavior**

Replace `packages/iso/src/__tests__/define-page.test.ts` in full:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { definePage, type PageBindings } from '../define-page.js';
import { defineLoader } from '../define-loader.js';

const fakeLocation: RouteHook = {
  url: '/test',
  path: '/test',
  query: '',
  pathParams: {},
  searchParams: {},
  route: () => {},
} as RouteHook;

describe('definePage', () => {
  it('returns a routable component that self-wraps in <Page> with loader bindings', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello' }));
    function Body() {
      // useLoaderData would normally pull from context; here we just verify
      // the page component renders. Loader behavior is covered in loader.test.
      return <p>body</p>;
    }
    const PageRoute = definePage(Body, { loader });
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    // The <Page> wrapper should produce a section with data-loader attribute.
    // We assert the body rendered to confirm the wrapper composed correctly.
    expect(await screen.findByText('body')).toBeInTheDocument();
  });

  it('returns a routable component for a binding-less page', () => {
    function Body() {
      return <p>plain</p>;
    }
    const PageRoute = definePage(Body);
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    expect(screen.getByText('plain')).toBeInTheDocument();
  });

  it('threads fallback, errorFallback, serverGuards, clientGuards into <Page>', () => {
    const bindings: PageBindings<{ ok: true }> = {
      fallback: <p>loading-state</p>,
      serverGuards: [],
      clientGuards: [],
    };
    function Body() {
      return <p>ok</p>;
    }
    const PageRoute = definePage(Body, bindings);
    // Smoke test: it renders without error. Detailed guard/fallback behavior
    // is covered in guards.test and page.test.
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('preserves the wrapped component name in displayName for debuggability', () => {
    function Movies() {
      return <p>movies</p>;
    }
    Movies.displayName = 'Movies';
    const PageRoute = definePage(Movies);
    expect(PageRoute.displayName).toBe('definePage(Movies)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/iso/src/__tests__/define-page.test.ts`

Expected: FAIL — `PageRoute` from the new test is a component returned by the *current* `definePage`, which doesn't take a `RouteHook` prop. Several tests will throw or produce unexpected output.

- [ ] **Step 3: Rewrite `definePage` to self-wrap**

Replace `packages/iso/src/define-page.ts` in full:

```tsx
import type { ComponentType, FunctionComponent, JSX } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { LoaderRef } from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { GuardFn } from './guard.js';
import { Page, type WrapperProps } from './page.js';

export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

/**
 * Wrap a page component with its per-page bindings (loader, cache, fallback,
 * guards, etc.) and return a routable component that self-wraps in `<Page>`.
 *
 * The output is a function `(location: RouteHook) => JSX.Element` that
 * `preact-iso`'s `<Route component={...}>` calls directly. No marker symbols,
 * no introspection, no custom router required.
 */
export function definePage<T>(
  Component: ComponentType,
  bindings?: PageBindings<T>
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page<T>
      loader={bindings?.loader}
      cache={bindings?.cache}
      Wrapper={bindings?.Wrapper}
      fallback={bindings?.fallback}
      errorFallback={bindings?.errorFallback}
      serverGuards={bindings?.serverGuards}
      clientGuards={bindings?.clientGuards}
      location={location}
    >
      <Component />
    </Page>
  );
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name ?? 'Anonymous'})`;
  return PageRoute;
}
```

The `PAGE_BINDINGS` symbol export and `PageComponent` type are gone from this file.

- [ ] **Step 4: Update `index.ts` to re-export `Route`/`Router`/`lazy` from preact-iso and drop deleted exports**

Open `packages/iso/src/index.ts`. Replace the routing-section exports:

```diff
-export { Route, Router, wrapWithPage } from './route.js';
-export type { RouteProps, RouterProps, RouteConfig, PageConfig } from './route.js';
-
-// Wrapped lazy that exposes the resolved default for binding lookup. API is
-// otherwise identical to preact-iso's lazy.
-export { lazy } from './lazy.js';
-export type { LazyComponent } from './lazy.js';
+// Routing primitives — trivial re-exports of preact-iso. Listed here so
+// consumers have a single import surface for everything they need.
+export { Route, Router, lazy } from 'preact-iso';
```

In the `definePage` re-export block, drop `PAGE_BINDINGS` and `PageComponent`:

```diff
-export { definePage, PAGE_BINDINGS } from './define-page.js';
-export type { PageBindings, PageComponent } from './define-page.js';
+export { definePage } from './define-page.js';
+export type { PageBindings } from './define-page.js';
```

- [ ] **Step 5: Update `apps/app/src/iso.tsx` to drop `IsoRoute`**

Open `apps/app/src/iso.tsx`. Drop the `IsoRoute` import and the workaround for `/docs`:

```diff
-import { Route as IsoRoute } from 'preact-iso';
 import NotFound from './pages/not-found.js';
```

Replace the `<IsoRoute>` lines with `<Route>` from `@hono-preact/iso` (which is now the same primitive):

```diff
-      {/* IsoRoute (preact-iso's Route) so both /docs and /docs/* hand the
-          same DocsRoute lazy reference to preact-iso. With our @hono-preact/iso
-          Route, wrapWithPage would mint a new PageRouteHandler per Route, and
-          preact-iso's component-identity check would treat /docs <-> /docs/foo
-          as a route change and remount DocsRoute (and the sidebar with it).
-          DocsRoute has no definePage bindings, so PageBoundary wrapping isn't
-          needed here. */}
-      <IsoRoute path="/docs" component={DocsRoute} />
-      <IsoRoute path="/docs/*" component={DocsRoute} />
+      <Route path="/docs" component={DocsRoute} />
+      <Route path="/docs/*" component={DocsRoute} />
```

The full file should now have a single import for routing primitives:

```tsx
import { lazy, Route, Router } from '@hono-preact/iso';
```

- [ ] **Step 6: Delete the obsolete source and test files**

```bash
rm packages/iso/src/route.tsx
rm packages/iso/src/lazy.ts
rm packages/iso/src/__tests__/route.test.tsx
rm packages/iso/src/__tests__/lazy.test.tsx
```

If any test outside `route.test.tsx` or `lazy.test.tsx` references `wrapWithPage`, `PAGE_BINDINGS`, `PageComponent`, the wrapped `lazy`, or `LazyComponent`, you'll see a TypeScript error in the next step. That's expected — fix call sites by either removing the test (if it was specific to the deleted machinery) or updating it (if it was testing something else that incidentally used these). Common cases:

- `define-page.test.ts` (already replaced in Step 1).
- `page.test.tsx` may reference `wrapWithPage` to set up routes; if so, update the test to render `definePage`'s output directly instead.

- [ ] **Step 7: Run all tests**

Run: `pnpm test`

Expected: PASS — every package's suite green. If a test outside the deleted ones fails because it references removed machinery, fix it as part of this commit.

- [ ] **Step 8: Build to confirm no type errors**

Run: `pnpm build`

Expected: clean build, no TypeScript errors.

- [ ] **Step 9: Smoke test the running app**

Run `pnpm dev` in the background. Verify:
- `http://localhost:5173/` (home) renders.
- `http://localhost:5173/movies` renders with data; the loader RPC fires correctly on client-side navigation.
- `http://localhost:5173/movies/1` renders.
- `http://localhost:5173/watched` renders, with the briefly-visible loading state from the new `fallback` binding.
- `http://localhost:5173/docs` renders, and clicking through nested doc routes does NOT remount the docs sidebar (this was the original reason for `IsoRoute`).

Kill the dev server when done.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(iso): definePage self-wraps in <Page>; drop custom Route/Router/lazy"
```

---

## Task 4: Drop `wrapWithPage` and `PAGE_BINDINGS` from any lingering callers

**Files:**
- Search the repo for remaining references and clean up.

After Task 3, `wrapWithPage` and `PAGE_BINDINGS` are no longer exported. This task is a sweep for any internal references that survived (in tests, in stale comments, in the iso package source).

- [ ] **Step 1: Find lingering references**

Run from the repo root:

```bash
grep -rn 'wrapWithPage\|PAGE_BINDINGS\|PageComponent' --include='*.ts' --include='*.tsx' .
```

Expected: zero matches if Task 3 was thorough. Any matches are residue.

- [ ] **Step 2: Clean up any matches**

For each match:
- If it's in a test that asserted on the old machinery, delete the assertion or the whole test as appropriate.
- If it's in a stale comment, remove the comment.
- If it's in a .d.ts dist artifact, ignore (those regenerate on `pnpm build`).

- [ ] **Step 3: Confirm tests + build still pass**

```bash
pnpm test && pnpm build
```

- [ ] **Step 4: Commit (only if there were changes)**

```bash
git add -A
git commit -m "chore(iso): clean up lingering wrapWithPage/PAGE_BINDINGS references"
```

If there were no changes, skip the commit and move on.

---

## Task 5: Create the `@hono-preact/iso/internal` subpath

**Files:**
- Create: `packages/iso/src/internal.ts`
- Create: `packages/iso/src/__tests__/internal.test.ts`
- Modify: `packages/iso/package.json`

The granular composition pieces (`Loader`, `Envelope`, `RouteBoundary`, `Guards`, `GuardGate`, `OptimisticOverlay`, contexts, SSR primitives) stay in source; this task adds a subpath entry so advanced consumers can reach them without forking the package.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/internal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as internal from '../internal.js';

describe('@hono-preact/iso/internal', () => {
  it('exposes the granular composition primitives', () => {
    expect(typeof internal.Loader).toBe('function');
    expect(typeof internal.Envelope).toBe('function');
    expect(typeof internal.RouteBoundary).toBe('function');
    expect(typeof internal.Guards).toBe('function');
    expect(typeof internal.GuardGate).toBe('function');
    expect(typeof internal.OptimisticOverlay).toBe('function');
    expect(typeof internal.useGuardResult).toBe('function');
  });

  it('exposes the context objects for advanced consumers', () => {
    expect(internal.LoaderIdContext).toBeDefined();
    expect(internal.LoaderDataContext).toBeDefined();
    expect(internal.GuardResultContext).toBeDefined();
    expect(internal.ReloadContext).toBeDefined();
  });

  it('exposes the SSR + low-level helpers', () => {
    expect(typeof internal.getPreloadedData).toBe('function');
    expect(typeof internal.deletePreloadedData).toBe('function');
    expect(typeof internal.runRequestScope).toBe('function');
    expect(typeof internal.wrapPromise).toBe('function');
    expect(typeof internal.runGuards).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/iso/src/__tests__/internal.test.ts`

Expected: FAIL — module `'../internal.js'` not found.

- [ ] **Step 3: Create `internal.ts`**

Create `packages/iso/src/internal.ts`:

```ts
// @hono-preact/iso/internal — escape hatch for advanced consumers.
//
// These primitives compose the default `<Page>` pipeline. They're kept
// behind a subpath so the front door (`@hono-preact/iso`) stays small.
// Use them when `definePage` bindings or `<Page>` props don't express
// what you need (e.g. distinct fallbacks for guards vs. loader, custom
// pipeline ordering, advanced SSR work).
//
// The contract here is intentionally less stable than the package's main
// surface. Internal symbols may change shape between minor versions.

export { Loader } from './loader.js';
export { Envelope } from './envelope.js';
export { RouteBoundary } from './route-boundary.js';
export { Guards, GuardGate, useGuardResult } from './guards.js';
export { OptimisticOverlay } from './optimistic-overlay.js';

export {
  LoaderIdContext,
  LoaderDataContext,
  GuardResultContext,
} from './contexts.js';
export { ReloadContext } from './reload-context.js';

export { getPreloadedData, deletePreloadedData } from './preload.js';
export { runRequestScope } from './cache.js';
export { default as wrapPromise } from './wrap-promise.js';
export { runGuards } from './guard.js';
```

- [ ] **Step 4: Update `package.json` to expose the subpath**

Update `packages/iso/package.json` `exports`:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./internal": {
      "types": "./dist/internal.d.ts",
      "import": "./dist/internal.js"
    }
  }
}
```

- [ ] **Step 5: Build + run the test**

Run: `pnpm --filter @hono-preact/iso build && pnpm test packages/iso/src/__tests__/internal.test.ts`

Expected: build succeeds; `dist/internal.d.ts` and `dist/internal.js` are emitted; the test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal.ts packages/iso/src/__tests__/internal.test.ts packages/iso/package.json
git commit -m "feat(iso): add @hono-preact/iso/internal subpath for advanced consumers"
```

---

## Task 6: Trim `index.ts` to the new public surface

**Files:**
- Modify: `packages/iso/src/index.ts`

Move the demoted exports out of `index.ts`. After this task, the front door matches the research doc's §5 listing.

- [ ] **Step 1: Replace `index.ts` in full**

Replace `packages/iso/src/index.ts` with:

```ts
// Page declaration and the <Page> escape hatch.
export { Page } from './page.js';
export type { PageProps, WrapperProps } from './page.js';
export { definePage } from './define-page.js';
export type { PageBindings } from './define-page.js';

// Routing primitives — trivial re-exports of preact-iso. Listed here so
// consumers have a single import surface for everything they need.
export { Route, Router, lazy } from 'preact-iso';

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
} from './define-loader.js';
export { defineAction, useAction } from './action.js';
export type {
  ActionStub,
  UseActionOptions,
  UseActionResult,
  ActionGuardContext,
  ActionGuardFn,
} from './action.js';
export { ActionGuardError, defineActionGuard } from './action.js';

// Hooks.
export { useLoaderData } from './use-loader-data.js';
export { useReload } from './reload-context.js';
export { useOptimistic } from './optimistic.js';
export type { OptimisticHandle } from './optimistic.js';
export { useOptimisticAction } from './optimistic-action.js';
export type {
  UseOptimisticActionOptions,
  UseOptimisticActionResult,
} from './optimistic-action.js';

// Forms.
export { Form } from './form.js';

// Cache + invalidation.
export { createCache } from './cache.js';
export type { LoaderCache } from './cache.js';
export { cacheRegistry } from './cache-registry.js';

// Guards.
export { createGuard, GuardRedirect } from './guard.js';
export type { GuardFn, GuardResult, GuardContext } from './guard.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { isBrowser, env } from './is-browser.js';
```

(Note: `useReload` was previously imported from `./reload-context.js` but the symbol is the same; verify the import path matches the source file.)

- [ ] **Step 2: Run all tests**

Run: `pnpm test`

Expected: PASS — every suite green. If a test in the iso package or elsewhere imported one of the demoted names from `'@hono-preact/iso'` directly, you'll see an error. Fix by importing from `'@hono-preact/iso/internal'`. Common candidates: tests that directly construct `<Loader>`, `<Envelope>`, `<RouteBoundary>`, `<Guards>` for unit testing.

- [ ] **Step 3: Build to confirm types**

Run: `pnpm build`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "refactor(iso): trim index.ts to the new public surface"
```

---

## Task 7: Sweep tests and source for any imports of demoted names

**Files:**
- Various test files (and possibly some source files) across the repo.

This is a cleanup sweep: any code that imported a demoted name from `'@hono-preact/iso'` needs to switch to `'@hono-preact/iso/internal'`.

- [ ] **Step 1: Find consumers of demoted names**

Run:

```bash
grep -rn "from '@hono-preact/iso'" --include='*.ts' --include='*.tsx' . | \
  grep -E "Loader|Envelope|RouteBoundary|Guards|GuardGate|useGuardResult|OptimisticOverlay|LoaderIdContext|LoaderDataContext|GuardResultContext|ReloadContext|getPreloadedData|deletePreloadedData|runRequestScope|wrapPromise|runGuards"
```

(`Loader` here will also match `LoaderRef`, `LoaderCtx`, `LoaderFn`, `useLoaderData`, etc. — those are still public. Filter manually.)

- [ ] **Step 2: Update each match**

For each file that imports a demoted name from `'@hono-preact/iso'`, change the import to `'@hono-preact/iso/internal'`. Group remaining public imports in a separate import statement so the file has two clear import lines:

```ts
import { definePage, useLoaderData } from '@hono-preact/iso';
import { LoaderDataContext } from '@hono-preact/iso/internal';
```

- [ ] **Step 3: Run tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: route demoted iso imports through @hono-preact/iso/internal"
```

If there were no matches in Step 1, skip this task entirely.

---

## Task 8: Final integration sweep + PR

**Files:** none.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: PASS — every package's suite green.

- [ ] **Step 2: Build every package**

Run: `pnpm build`

Expected: clean.

- [ ] **Step 3: Smoke-test the running app**

Run `pnpm dev` in background. Verify all the page flows from Task 3 Step 9 still work:
- `/`, `/movies`, `/movies/:id`, `/watched`, `/docs`, `/docs/<sub-route>` all render
- The `/watched` fallback still appears briefly
- The `/docs` sidebar does NOT remount on nested-route changes
- `POST /__loaders` and `POST /__actions` still route correctly (path-keyed identity from Plan A is unaffected by this work)

Kill the dev server.

- [ ] **Step 4: Confirm the public surface count**

Run from the repo root:

```bash
grep -E "^export " packages/iso/src/index.ts | wc -l
```

Expected: ~17 export lines (the research doc's target). If significantly higher, look for re-exports that should have moved to `/internal`.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: trim @hono-preact/iso surface; definePage self-wraps" \
  --body "$(cat <<'EOF'
## Summary

- Drops the custom `Route`/`Router`/`wrapWithPage`/`PAGE_BINDINGS` orchestration. `definePage(Component, bindings)` now returns a routable component that self-wraps in `<Page>`.
- Re-exports `Route`, `Router`, `lazy` from `preact-iso` directly. Consumers keep their import path; the magic is gone.
- Demotes the granular composition pieces (`Loader`, `Envelope`, `RouteBoundary`, `Guards`, `GuardGate`, `OptimisticOverlay`, contexts, SSR helpers) to a `@hono-preact/iso/internal` subpath.
- Moves route-level props (`fallback`, `errorFallback`, `serverGuards`, `clientGuards`) into `PageBindings`. The lone consumer (`/watched`) migrates.
- The `IsoRoute` workaround in `apps/app/src/iso.tsx` is gone, along with its multi-line comment.
- Public surface drops from ~30 names to ~17.

## Test plan

- [ ] `pnpm test` — all suites green
- [ ] `pnpm build` — clean
- [ ] Dev: `/`, `/movies`, `/movies/:id`, `/watched` (with fallback), `/docs`, nested doc routes all render
- [ ] Dev: nested doc-route navigation does NOT remount the docs sidebar
- [ ] Dev: `POST /__loaders` and `POST /__actions` still route by path key (unchanged from Plan A)

Implements: §3, §5, §6, §7, §9 steps 2-6 of `docs/superpowers/research/2026-05-04-framework-simplification.md`.
EOF
)"
```

---

## Risks & rollback

**Atomic switch in Task 3.** The `definePage` self-wrap and the deletion of the custom `Route`/`Router` must land together. Halfway between the two, every page double-wraps. If Task 3's tests or smoke checks reveal a problem, revert the entire Task 3 commit; don't try to fix forward.

**SSR `useId` parity.** `<Loader>` calls `useId()` to key SSR-injected data. Adding or removing wrapper components on the path between `<Page>` and `<Loader>` shifts the fiber-position id, which can break hydration. This task moves `<Page>` from "the route handler" to "inside the page component," which technically introduces one new fiber position (the wrapper function returned by `definePage`). If hydration breaks after Task 3, this is the suspect — confirm by comparing the server-rendered `data-loader` attribute's id to the client-side `useId()` call. The fix in that case is small: ensure `definePage`'s returned function is a plain functional component (not memoized or wrapped in `forwardRef`-style indirection) so the fiber position is predictable.

**Consumer breakage.** Anyone importing `wrapWithPage`, `PAGE_BINDINGS`, `PageComponent`, `RouteProps`, `RouterProps`, `RouteConfig`, `PageConfig`, `LazyComponent`, or the demoted granular pieces from `'@hono-preact/iso'` will see a TypeScript error after this PR. The migration is one of:
- Use `definePage` and `<Page>` instead (most cases).
- Switch to `'@hono-preact/iso/internal'` for the granular pieces (advanced cases).
- For `RouteProps`/`RouterProps`/etc., type from `preact-iso` directly.

The repo's only consumer is `apps/app/`, which Task 3 migrates. External forks would need the same edits.

---

## What this plan does NOT cover

- The deferred direction-#4 work: `useId`-keyed SSR hydration, monolithic `<Page>` internals, streaming SSR, Worker prefetch. Direction #4 is a separate research strand.
- Renaming any public API. Names that survive (`definePage`, `Page`, `defineLoader`, etc.) keep their current spelling.
- Splitting `@hono-preact/iso` into a pure-JS core plus framework adapter. That's direction #4.
