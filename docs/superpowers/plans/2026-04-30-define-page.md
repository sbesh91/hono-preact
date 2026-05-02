# `definePage`: Page-Owned Route Bindings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-page bindings (loader, cache, Wrapper) from `<Route>` props in `iso.tsx` onto the page component itself via a new `definePage` helper. `iso.tsx` becomes paths + lazy refs only; `useLoaderData` becomes argument-free.

**Architecture:** Add `definePage` to `@hono-preact/iso`, which mutates a component to attach a `PAGE_BINDINGS` symbol. Wrap preact-iso's `lazy()` to expose the resolved default export. `<Route>` drops `loader`/`cache`/`Wrapper` props; `wrapWithPage` reads them from `PAGE_BINDINGS` (suspending on lazy resolution if needed) and passes them to the existing `<Page>` primitive.

**Tech Stack:** TypeScript, Preact, preact-iso (`lazy`/`Router`/`Route`), Vitest, happy-dom, @testing-library/preact.

**Spec:** `docs/superpowers/specs/2026-04-30-define-page-design.md`

---

## Pre-flight context for the executing engineer

- This work is on top of `main` after PR #4 (`feat/iso-route-level-loaders`) merged. Recommend a fresh branch like `feat/define-page`.
- Read these files to understand the surfaces you'll touch:
  - `packages/iso/src/route.tsx` — current `<Route>`/`<Router>`/`wrapWithPage`
  - `packages/iso/src/page.tsx` — the `<Page>` primitive (NOT changing — it stays as-is)
  - `packages/iso/src/loader.tsx` — `<Loader>` provides `LoaderDataContext`
  - `packages/iso/src/contexts.ts` — `LoaderDataContext` shape
  - `packages/iso/src/use-loader-data.ts` — runtime ref check (going away)
  - `packages/iso/src/define-loader.ts` — `LoaderRef<T>` (unchanged; `defineLoader('name', fn)` API stays)
  - `packages/iso/src/index.ts` — public export surface
  - `packages/iso/src/__tests__/route.test.tsx`, `loader.test.tsx`, `page.test.tsx` — existing test patterns
  - `apps/app/src/iso.tsx` — central route table
  - `apps/app/src/pages/movies.tsx`, `movie.tsx`, `watched.tsx` — pages with loaders
  - `apps/app/src/pages/movies.tsx` (nested `<Router>` for `/movies/:id`)
- Run `pnpm test` from repo root — confirm all tests pass before starting (the spec assumes this).
- Run `pnpm --filter app build` — confirm clean.

This is a coordinated, breaking refactor of `<Route>` props and `useLoaderData`. There is **no parallel-old-and-new API window** — pages and tests migrate in the same branch. Plan that into your commit cadence: tests for the new shape may break tests for the old shape mid-task; that's expected.

---

## File Structure

### New files
- `packages/iso/src/define-page.ts` — `definePage` helper, `PAGE_BINDINGS` symbol, types
- `packages/iso/src/__tests__/define-page.test.ts` — unit tests for `definePage`
- `packages/iso/src/lazy.ts` — wrapper around `preact-iso/lazy` exposing resolved default
- `packages/iso/src/__tests__/lazy.test.tsx` — unit tests for the wrapper

### Modified files
- `packages/iso/src/index.ts` — add new exports, switch `lazy` re-export source
- `packages/iso/src/route.tsx` — `<Route>` props slim down; `wrapWithPage` reads `PAGE_BINDINGS`
- `packages/iso/src/contexts.ts` — drop `refId` from `LoaderDataContext`
- `packages/iso/src/loader.tsx` — pass only `{ data }` into `LoaderDataContext`
- `packages/iso/src/use-loader-data.ts` — argument-free signature with conditional generic
- `packages/iso/src/__tests__/route.test.tsx` — migrate test patterns
- `packages/iso/src/__tests__/loader.test.tsx` — migrate `useLoaderData(ref)` → `useLoaderData<typeof ref>()`
- `packages/iso/src/__tests__/define-loader.test.ts` — drop comments referencing the dead `refId === ref.__id` check
- `apps/app/src/iso.tsx` — drop server imports, drop loader/cache/Wrapper props
- `apps/app/src/pages/movies.tsx` — `definePage`, drop nested `Wrapper` prop, `useLoaderData<typeof loader>()`
- `apps/app/src/pages/movie.tsx` — `definePage` with `Wrapper`, `useLoaderData<typeof loader>()`
- `apps/app/src/pages/watched.tsx` — `definePage`, `useLoaderData<typeof loader>()`
- `apps/app/src/pages/docs/*.mdx` — update examples to new API

### Files NOT touched
- `packages/iso/src/page.tsx` — `<Page>` is the internal primitive; its props stay (loader, cache, Wrapper); only the *source* of those values changes upstream.
- `packages/iso/src/define-loader.ts` — `defineLoader('name', fn)` signature unchanged.
- `packages/iso/src/cache.ts` and `cache-registry.ts` — unchanged.
- `packages/iso/src/prefetch.ts` — operates on `LoaderRef` directly; unaffected.
- `packages/server/**` — server-side loader dispatch is unchanged (still keys off the `module` field of the RPC body and reads the default export).
- `packages/vite/**` — `serverOnlyPlugin` already handles `loader`/`cache`/`serverActions` specifiers; no new specifiers introduced.

---

## Task 1: Add `definePage` helper

**Why:** This is the smallest, most isolated piece — no other tasks depend on shape changes, so getting it landed first gives a stable target. Pure unit-testable function plus types.

**Files:**
- Create: `packages/iso/src/define-page.ts`
- Create: `packages/iso/src/__tests__/define-page.test.ts`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/iso/src/__tests__/define-page.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { definePage, PAGE_BINDINGS, type PageComponent } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import { createCache } from '../cache.js';

describe('definePage', () => {
  it('attaches bindings under the realm-wide PAGE_BINDINGS symbol', () => {
    const fn = async () => ({ msg: 'ok' });
    const loader = defineLoader<{ msg: string }>('define-page-test-1', fn);
    const cache = createCache<{ msg: string }>('define-page-test-1');
    const Inner = () => null;

    const Wrapped = definePage(Inner, { loader, cache });

    expect(Wrapped).toBe(Inner);
    expect((Wrapped as PageComponent<{ msg: string }>)[PAGE_BINDINGS]).toEqual({
      loader,
      cache,
    });
  });

  it('uses Symbol.for for cross-module identity', () => {
    expect(PAGE_BINDINGS).toBe(Symbol.for('@hono-preact/iso/page-bindings'));
  });

  it('returns the same component reference (no wrapper)', () => {
    const Inner = () => null;
    const Wrapped = definePage(Inner);
    expect(Wrapped).toBe(Inner);
  });

  it('treats omitted bindings as no-op (no symbol attached)', () => {
    const Inner = () => null;
    definePage(Inner);
    expect((Inner as PageComponent<unknown>)[PAGE_BINDINGS]).toBeUndefined();
  });

  it('replaces previously-attached bindings if called twice on the same component', () => {
    const fn1 = async () => ({ a: 1 });
    const fn2 = async () => ({ b: 2 });
    const loader1 = defineLoader('define-page-test-replace-1', fn1);
    const loader2 = defineLoader('define-page-test-replace-2', fn2);
    const Inner = () => null;

    definePage(Inner, { loader: loader1 });
    definePage(Inner, { loader: loader2 });

    expect((Inner as PageComponent<unknown>)[PAGE_BINDINGS]).toEqual({
      loader: loader2,
    });
  });

  it('accepts a Wrapper component in bindings', () => {
    const Inner = () => null;
    const Wrapper = (props: { children: unknown }) =>
      props.children as never;

    const Wrapped = definePage(Inner, { Wrapper });

    expect((Wrapped as PageComponent<unknown>)[PAGE_BINDINGS]).toEqual({
      Wrapper,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/iso/src/__tests__/define-page.test.ts
```

Expected: FAIL — `Cannot find module '../define-page.js'`.

- [ ] **Step 3: Implement `define-page.ts`**

Create `packages/iso/src/define-page.ts`:

```ts
import type { ComponentType } from 'preact';
import type { LoaderRef } from './define-loader.js';
import type { LoaderCache } from './cache.js';
import type { WrapperProps } from './page.js';

export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
};

// Symbol.for so duplicate module copies (HMR, pnpm phantom deps) still match.
export const PAGE_BINDINGS = Symbol.for('@hono-preact/iso/page-bindings');

export type PageComponent<T> = ComponentType & {
  [PAGE_BINDINGS]?: PageBindings<T>;
};

export function definePage<T>(
  Component: ComponentType,
  bindings?: PageBindings<T>
): PageComponent<T> {
  if (bindings) {
    (Component as PageComponent<T>)[PAGE_BINDINGS] = bindings;
  }
  return Component as PageComponent<T>;
}
```

- [ ] **Step 4: Export from package root**

Modify `packages/iso/src/index.ts` — add after the `defineLoader` export block:

```ts
export { definePage, PAGE_BINDINGS } from './define-page.js';
export type { PageBindings, PageComponent } from './define-page.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm vitest run packages/iso/src/__tests__/define-page.test.ts
```

Expected: 6 passing.

- [ ] **Step 6: Run the full iso test suite to verify nothing broke**

```bash
pnpm vitest run packages/iso
```

Expected: all green (existing tests + 6 new).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/define-page.ts packages/iso/src/__tests__/define-page.test.ts packages/iso/src/index.ts
git commit -m "feat(iso): add definePage helper for page-owned route bindings"
```

---

## Task 2: Wrap `lazy()` to expose resolved default export

**Why:** `<Route>` needs to read `PAGE_BINDINGS` off the resolved component, but preact-iso's `lazy` keeps the resolved value in a closure with no public accessor. We wrap it so `wrapWithPage` can synchronously check whether the module has resolved, suspend on the import promise if not, and read the default export's `[PAGE_BINDINGS]` once it has.

**Files:**
- Create: `packages/iso/src/lazy.ts`
- Create: `packages/iso/src/__tests__/lazy.test.tsx`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/iso/src/__tests__/lazy.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { lazy } from '../lazy.js';

describe('lazy() wrapper', () => {
  it('returns a component with preload() that resolves to the module', async () => {
    const Mod = { default: () => null, marker: 'movies-mod' };
    const Lazy = lazy(async () => Mod);
    const m = await Lazy.preload();
    expect(m).toBe(Mod);
  });

  it('returns null from getResolvedDefault before preload', () => {
    const Lazy = lazy(async () => ({ default: () => null }));
    expect(Lazy.getResolvedDefault()).toBeNull();
  });

  it('returns the resolved default after preload completes', async () => {
    const Inner = () => null;
    const Lazy = lazy(async () => ({ default: Inner }));
    await Lazy.preload();
    expect(Lazy.getResolvedDefault()).toBe(Inner);
  });

  it('also handles modules whose export is the component itself (no default key)', async () => {
    // preact-iso's lazy supports `m.default || m` — preserve that behavior.
    const Inner = () => null;
    const Lazy = lazy(async () => Inner as unknown as { default: typeof Inner });
    await Lazy.preload();
    expect(Lazy.getResolvedDefault()).toBe(Inner);
  });

  it('preload() returns the same promise on repeated calls', () => {
    const Lazy = lazy(async () => ({ default: () => null }));
    const p1 = Lazy.preload();
    const p2 = Lazy.preload();
    expect(p1).toBe(p2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run packages/iso/src/__tests__/lazy.test.tsx
```

Expected: FAIL — `Cannot find module '../lazy.js'`.

- [ ] **Step 3: Implement `lazy.ts`**

Create `packages/iso/src/lazy.ts`:

```ts
import type { ComponentType } from 'preact';
import { lazy as preactIsoLazy } from 'preact-iso';

export interface LazyComponent<P = {}> extends ComponentType<P> {
  preload: () => Promise<unknown>;
  getResolvedDefault: () => ComponentType | null;
}

type ModuleLike = { default?: ComponentType } | ComponentType;

export function lazy<P = {}>(
  load: () => Promise<ModuleLike>
): LazyComponent<P> {
  let resolved: ComponentType | null = null;
  let modulePromise: Promise<ModuleLike> | null = null;

  // Single source of truth for the import. Side-effect: also caches the
  // resolved default. Returns the original module-like value so callers of
  // preload() see what `load()` actually returned.
  const ensure = (): Promise<ModuleLike> => {
    if (!modulePromise) {
      modulePromise = load().then((m) => {
        const c =
          (m && (m as { default?: ComponentType }).default) ??
          (m as ComponentType);
        resolved = c;
        return m;
      });
    }
    return modulePromise;
  };

  // Hand preact-iso's lazy a stable factory that adapts the module to the
  // {default: Component} shape it expects. This shares `ensure`'s cache, so
  // the underlying load() runs at most once across our preload() callers and
  // preact-iso's own first-render preload.
  const Inner = preactIsoLazy(() =>
    ensure().then((m) => ({
      default:
        (m as { default?: ComponentType }).default ??
        (m as unknown as ComponentType),
    }))
  ) as unknown as LazyComponent<P>;

  Inner.preload = ensure;
  Inner.getResolvedDefault = () => resolved;

  return Inner;
}
```

> **Note on double-suspend:** when `wrapWithPage` throws `lazyish.preload()` to wait for the module, then renders `<Component />`, preact-iso's internal lazy state may suspend a second time on its own first render. Both suspends share the same cached module promise, so the second resolves on the next microtask — visible as a single Suspense fallback, not two flashes. Accepted as the cost of layering on top of preact-iso's lazy rather than rolling a new one.

- [ ] **Step 4: Switch the package's `lazy` export to use the wrapper**

Modify `packages/iso/src/index.ts`:

Replace:
```ts
// Convenience re-export so consumers don't need to import from preact-iso
// alongside @hono-preact/iso.
export { lazy } from 'preact-iso';
```

with:
```ts
// Wrapped lazy that exposes the resolved default for binding lookup. API is
// otherwise identical to preact-iso's lazy.
export { lazy } from './lazy.js';
export type { LazyComponent } from './lazy.js';
```

- [ ] **Step 5: Run the lazy tests**

```bash
pnpm vitest run packages/iso/src/__tests__/lazy.test.tsx
```

Expected: 5 passing.

- [ ] **Step 6: Run the full iso test suite**

```bash
pnpm vitest run packages/iso
```

Expected: all green. The change to `lazy`'s export source should be transparent for consumers — preact-iso's component behavior is preserved.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/lazy.ts packages/iso/src/__tests__/lazy.test.tsx packages/iso/src/index.ts
git commit -m "feat(iso): wrap lazy() to expose resolved default for page-binding lookup"
```

---

## Task 3: Drop `refId` from `LoaderDataContext`; make `useLoaderData()` argument-free

**Why:** The page no longer imports the loader ref, so the runtime ref-identity check has nothing to verify against. Drop it before changing `<Route>` so the type changes propagate cleanly. This task is independent of the route-binding changes and gives us a clean checkpoint.

**Files:**
- Modify: `packages/iso/src/contexts.ts`
- Modify: `packages/iso/src/loader.tsx`
- Modify: `packages/iso/src/use-loader-data.ts`
- Modify: `packages/iso/src/__tests__/loader.test.tsx`
- Modify: `packages/iso/src/__tests__/define-loader.test.ts` (comments only)

- [ ] **Step 1: Update `LoaderDataContext` shape**

Modify `packages/iso/src/contexts.ts`:

Replace:
```ts
export const LoaderDataContext = createContext<{
  refId: symbol;
  data: unknown;
} | null>(null);
```

with:
```ts
export const LoaderDataContext = createContext<{
  data: unknown;
} | null>(null);
```

- [ ] **Step 2: Update `<Loader>`'s context provider in `loader.tsx`**

Modify `packages/iso/src/loader.tsx`:

In `DataReader`, replace:
```tsx
return (
  <LoaderDataContext.Provider value={{ refId, data }}>
    {children}
  </LoaderDataContext.Provider>
);
```

with:
```tsx
return (
  <LoaderDataContext.Provider value={{ data }}>
    {children}
  </LoaderDataContext.Provider>
);
```

Also remove `refId` from `DataReaderProps`:

```tsx
type DataReaderProps<T> = {
  reader: { read: () => T };
  overrideData?: T;
  children: ComponentChildren;
};

function DataReader<T>({
  reader,
  overrideData,
  children,
}: DataReaderProps<T>) {
  const data = overrideData !== undefined ? overrideData : reader.read();
  return (
    <LoaderDataContext.Provider value={{ data }}>
      {children}
    </LoaderDataContext.Provider>
  );
}
```

And in `LoaderHost`, remove `refId={loaderRef.__id}` from the `<DataReader>` invocation:

```tsx
<DataReader
  reader={readerRef.current}
  overrideData={overrideData}
>
  {children}
</DataReader>
```

- [ ] **Step 3: Rewrite `use-loader-data.ts`**

Replace the contents of `packages/iso/src/use-loader-data.ts`:

```ts
import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

export function useLoaderData<L>(): L extends LoaderRef<infer T> ? T : L {
  const ctx = useContext(LoaderDataContext);
  if (!ctx) {
    throw new Error(
      'useLoaderData must be called inside a route page that has a loader.'
    );
  }
  return ctx.data as never;
}
```

- [ ] **Step 4: Migrate the loader tests to the new signature**

Modify `packages/iso/src/__tests__/loader.test.tsx`. Every call site of `useLoaderData(ref)` must change to `useLoaderData<typeof ref>()`. Use `replace_all` semantics — there are five call sites in this file (lines 43, 65, 102, 145, 170 in the previous shape).

For each occurrence, replace:
```tsx
const { msg } = useLoaderData(ref);
```
with:
```tsx
const { msg } = useLoaderData<typeof ref>();
```

And likewise for `const { q } = useLoaderData(ref);` → `const { q } = useLoaderData<typeof ref>();`.

- [ ] **Step 5: Update `define-loader.test.ts` comments**

Modify `packages/iso/src/__tests__/define-loader.test.ts`. Find any reference to `useLoaderData(refId === ref.__id)` or the runtime ref-identity check in comments and either delete the comment or rephrase it. The runtime check no longer exists.

```bash
grep -n "refId\|ref\.__id" packages/iso/src/__tests__/define-loader.test.ts
```

Update each match. If a test asserts on `__id` matching that's still meaningful (the symbol-identity is used for prefetch keying), leave it. Only the "useLoaderData verifies refId" comments are stale.

- [ ] **Step 6: Run the loader and define-loader tests**

```bash
pnpm vitest run packages/iso/src/__tests__/loader.test.tsx packages/iso/src/__tests__/define-loader.test.ts
```

Expected: all green.

- [ ] **Step 7: Run the full iso suite**

```bash
pnpm vitest run packages/iso
```

Expected: `route.test.tsx` may still pass (its `useLoaderData(ref)` calls work because TS doesn't complain about an unused argument — it's just ignored at runtime now). If `route.test.tsx` fails on a type mismatch, that's fine; it'll be migrated in Task 4. If runtime tests fail, fix before continuing.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/contexts.ts packages/iso/src/loader.tsx packages/iso/src/use-loader-data.ts packages/iso/src/__tests__/loader.test.tsx packages/iso/src/__tests__/define-loader.test.ts
git commit -m "refactor(iso): drop refId from LoaderDataContext; useLoaderData() is argument-free"
```

---

## Task 4: Slim `<Route>` props; `wrapWithPage` reads `PAGE_BINDINGS`

**Why:** This is the load-bearing change. After this task, `<Route>` no longer accepts `loader`/`cache`/`Wrapper`, and `wrapWithPage` resolves them from the component's `PAGE_BINDINGS` (suspending on lazy if needed). Tests for the new shape go in first; existing tests are migrated as part of this task.

**Files:**
- Modify: `packages/iso/src/route.tsx`
- Modify: `packages/iso/src/__tests__/route.test.tsx`

- [ ] **Step 1: Read `route.tsx` end-to-end again**

Refresh on the current `wrapWithPage` and `<Router>`'s child-walking logic. Note the `ROUTE_MARKER` symbol pattern.

- [ ] **Step 2: Add a failing integration test for `<Route>` with a `definePage`'d component**

Append to `packages/iso/src/__tests__/route.test.tsx`, at the end of the existing `describe('<Router> + <Route>')` block, a new test:

```tsx
  it('reads loader/cache/Wrapper from PAGE_BINDINGS on the component', async () => {
    const fn = vi.fn(async () => ({ msg: 'page-data' }));
    const ref = defineLoader<{ msg: string }>('page-bindings-test', fn);

    const Inner = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="page">{msg}</p>;
    };
    const Wrapped = definePage(Inner, { loader: ref });

    window.history.pushState({}, '', '/page');
    render(
      <LocationProvider>
        <Router>
          <Route path="/page" component={Wrapped} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('page');
    expect(el).toHaveTextContent('page-data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads PAGE_BINDINGS off a lazy component once resolved', async () => {
    const fn = vi.fn(async () => ({ msg: 'lazy-data' }));
    const ref = defineLoader<{ msg: string }>('page-bindings-lazy-test', fn);

    const Inner = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="lazy-page">{msg}</p>;
    };
    const Wrapped = definePage(Inner, { loader: ref });
    const Lazy = lazy(async () => ({ default: Wrapped }));

    window.history.pushState({}, '', '/lazy');
    render(
      <LocationProvider>
        <Router>
          <Route path="/lazy" component={Lazy} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('lazy-page');
    expect(el).toHaveTextContent('lazy-data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('renders a component with no PAGE_BINDINGS without a loader (no-data page)', async () => {
    const Inner = () => <p data-testid="bare">no-data</p>;

    window.history.pushState({}, '', '/bare');
    render(
      <LocationProvider>
        <Router>
          <Route path="/bare" component={Inner} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('bare');
    expect(el).toHaveTextContent('no-data');
  });
```

Add the new imports at the top of the file (alongside existing ones):

```tsx
import { definePage } from '../define-page.js';
import { lazy } from '../lazy.js';
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
pnpm vitest run packages/iso/src/__tests__/route.test.tsx -t "PAGE_BINDINGS"
pnpm vitest run packages/iso/src/__tests__/route.test.tsx -t "no PAGE_BINDINGS"
```

Expected: tests fail. The current `<Route>` ignores PAGE_BINDINGS; `Movies` will render but `useLoaderData` will throw because no `<Loader>` mounted.

- [ ] **Step 4: Update `RouteProps` type and `wrapWithPage` to read bindings**

Modify `packages/iso/src/route.tsx` — full replacement:

```tsx
import {
  isValidElement,
  toChildArray,
  type ComponentChildren,
  type ComponentType,
  type JSX,
  type VNode,
} from 'preact';
import {
  Route as PreactIsoRoute,
  Router as PreactIsoRouter,
  type RouteHook,
} from 'preact-iso';
import { Page, type PageProps } from './page.js';
import { PAGE_BINDINGS, type PageComponent } from './define-page.js';
import type { LazyComponent } from './lazy.js';

// Route-level config — these stay on <Route>. Page-level (loader, cache,
// Wrapper) come from the component's PAGE_BINDINGS.
export type RouteConfig = Pick<
  PageProps<unknown>,
  'fallback' | 'errorFallback' | 'serverGuards' | 'clientGuards'
>;

export type RouteProps = RouteConfig & {
  path: string;
  component: ComponentType;
};

// Kept for back-compat consumers and tests.
export type PageConfig = RouteConfig;

function readBindings(component: ComponentType) {
  // Lazy component path: if not yet resolved, throw the preload promise so
  // Suspense can wait. Once resolved, read PAGE_BINDINGS off the resolved
  // default. Eager components carry PAGE_BINDINGS directly on themselves.
  const lazyish = component as LazyComponent;
  if (typeof lazyish.preload === 'function' && typeof lazyish.getResolvedDefault === 'function') {
    const resolved = lazyish.getResolvedDefault();
    if (!resolved) throw lazyish.preload();
    return (resolved as PageComponent<unknown>)[PAGE_BINDINGS];
  }
  return (component as PageComponent<unknown>)[PAGE_BINDINGS];
}

export function wrapWithPage(
  Component: ComponentType,
  config: RouteConfig
): (location: RouteHook) => JSX.Element {
  return function PageRouteHandler(location: RouteHook) {
    const bindings = readBindings(Component);
    return (
      <Page
        loader={bindings?.loader}
        cache={bindings?.cache}
        Wrapper={bindings?.Wrapper}
        fallback={config.fallback}
        errorFallback={config.errorFallback}
        serverGuards={config.serverGuards}
        clientGuards={config.clientGuards}
        location={location}
      >
        <Component />
      </Page>
    );
  };
}

const ROUTE_MARKER = Symbol.for('@hono-preact/iso/Route');

export function Route(_props: RouteProps): null {
  return null;
}
Route.displayName = 'Route';
(Route as unknown as Record<symbol, unknown>)[ROUTE_MARKER] = true;

function isOurRoute(node: unknown): node is VNode<RouteProps> {
  return (
    isValidElement(node) &&
    typeof node.type === 'function' &&
    (node.type as unknown as Record<symbol, unknown>)[ROUTE_MARKER] === true
  );
}

type PreactIsoRouterProps = {
  onRouteChange?: (url: string) => void;
  onLoadEnd?: (url: string) => void;
  onLoadStart?: (url: string) => void;
  children?: ComponentChildren;
};

export type RouterProps = Omit<PreactIsoRouterProps, 'children'> & {
  children?: ComponentChildren;
};

export function Router({ children, ...rest }: RouterProps): JSX.Element {
  const transformed = toChildArray(children).map((child) => {
    if (!isOurRoute(child)) return child;
    const { path, component, ...config } = child.props;
    return (
      <PreactIsoRoute
        path={path}
        component={wrapWithPage(component, config)}
      />
    );
  });
  return (
    <PreactIsoRouter {...rest}>
      {transformed as unknown as JSX.Element[]}
    </PreactIsoRouter>
  );
}
```

> **Note on Fragment recursion:** the existing `Router` does *not* explicitly recurse into Fragment children — that flattening is already handled by `toChildArray`. The four "Fragment recursion" tests in `route.test.tsx` should continue to pass without further work because `toChildArray` flattens `<Fragment>` and `<>...</>` children into a flat list.

- [ ] **Step 5: Migrate the existing `wrapWithPage` and `<Router> + <Route>` tests**

The previous test at line 47 is:
```tsx
it('renders the component with loader data via useLoaderData', async () => {
  const fn = vi.fn(async () => ({ msg: 'ok' }));
  const ref = defineLoader<{ msg: string }>('wrap-with-page-test', fn);
  const Inner = () => {
    const { msg } = useLoaderData(ref);
    return <p data-testid="msg">{msg}</p>;
  };
  const Wrapped = wrapWithPage(Inner, { loader: ref });
  // ...
});
```

Replace with:
```tsx
it('renders the component with loader data via useLoaderData', async () => {
  const fn = vi.fn(async () => ({ msg: 'ok' }));
  const ref = defineLoader<{ msg: string }>('wrap-with-page-test', fn);
  const Inner = () => {
    const { msg } = useLoaderData<typeof ref>();
    return <p data-testid="msg">{msg}</p>;
  };
  const Page = definePage(Inner, { loader: ref });
  const Wrapped = wrapWithPage(Page, {});
  render(
    <LocationProvider>
      <Wrapped {...loc} />
    </LocationProvider>
  );
  const el = await screen.findByText('ok');
  expect(el).toBeInTheDocument();
  expect(fn).toHaveBeenCalledTimes(1);
});
```

The previous test at line 67:
```tsx
it('renders the matched route wrapped in <Page> with loader data', async () => {
  // ...
  <Route path="/foo" component={Foo} loader={ref} />
  // ...
});
```

Replace with:
```tsx
it('renders the matched route wrapped in <Page> with loader data', async () => {
  const fn = vi.fn(async () => ({ msg: 'foo-data' }));
  const ref = defineLoader<{ msg: string }>('router-route-test', fn);
  const Foo = () => {
    const { msg } = useLoaderData<typeof ref>();
    return <p data-testid="foo">{msg}</p>;
  };
  const Page = definePage(Foo, { loader: ref });

  window.history.pushState({}, '', '/foo');
  render(
    <LocationProvider>
      <Router>
        <Route path="/foo" component={Page} />
      </Router>
    </LocationProvider>
  );

  const el = await screen.findByTestId('foo');
  expect(el).toHaveTextContent('foo-data');
  expect(fn).toHaveBeenCalledTimes(1);
});
```

(Other tests in this file that do not pass a `loader` prop need no change.)

- [ ] **Step 6: Run the route tests**

```bash
pnpm vitest run packages/iso/src/__tests__/route.test.tsx
```

Expected: all green.

- [ ] **Step 7: Run the full iso suite**

```bash
pnpm vitest run packages/iso
```

Expected: all green. If `page.test.tsx` fails (it shouldn't — `<Page>`'s API didn't change), fix the test rather than reverting the production change.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/route.tsx packages/iso/src/__tests__/route.test.tsx
git commit -m "feat(iso): <Route> reads loader/cache/Wrapper from PAGE_BINDINGS via wrapWithPage"
```

---

## Task 5: Migrate `apps/app` pages and `iso.tsx`

**Why:** Activate the new shape end-to-end in the consumer app. After this task, `apps/app/src/iso.tsx` no longer imports anything from a `*.server.ts` file.

**Files:**
- Modify: `apps/app/src/pages/movies.tsx`
- Modify: `apps/app/src/pages/movie.tsx`
- Modify: `apps/app/src/pages/watched.tsx`
- Modify: `apps/app/src/iso.tsx`

- [ ] **Step 1: Update `apps/app/src/pages/movies.tsx`**

Top of file (imports) — add `definePage` to the iso import; the `loader as moviesLoader` import is renamed to `loader` since we no longer need to disambiguate against the inner Movie loader (we no longer pass it through Route). The `loader` and `cache` value-imports stay (they're used in the `definePage` call):

Replace:
```tsx
import {
  cacheRegistry,
  lazy,
  Route,
  Router,
  useLoaderData,
  useOptimisticAction,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader as movieLoader } from './movie.server.js';
import { loader as moviesLoader, serverActions } from './movies.server.js';
import Noop from './noop.js';
```

with:
```tsx
import {
  cacheRegistry,
  definePage,
  lazy,
  Route,
  Router,
  useLoaderData,
  useOptimisticAction,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, cache, serverActions } from './movies.server.js';
import Noop from './noop.js';
```

Then remove the `MovieWrapper` component declaration and its usage in the nested `<Route>` (the wrapper moves to `movie.tsx` in the next step):

Remove:
```tsx
function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}
```

Update `useLoaderData` call:

Replace:
```tsx
const { movies, watchedIds } = useLoaderData(moviesLoader);
```

with:
```tsx
const { movies, watchedIds } = useLoaderData<typeof loader>();
```

Update the nested `<Router>` block — the inner `<Route>` no longer takes `loader`/`Wrapper` props:

Replace:
```tsx
<Router>
  <Route path="/:id" component={Movie} loader={movieLoader} Wrapper={MovieWrapper} />
  <Noop />
</Router>
```

with:
```tsx
<Router>
  <Route path="/:id" component={Movie} />
  <Noop />
</Router>
```

Replace the default export:

```tsx
export default Movies;
```

with:

```tsx
export default definePage(Movies, { loader, cache });
```

- [ ] **Step 2: Update `apps/app/src/pages/movie.tsx`**

Top of file — add `definePage` and `cache`-imports (movie has only `loader`, no `cache` in `movie.server.ts`; verify):

```bash
grep "export const cache" apps/app/src/pages/movie.server.ts
```

If no `cache` export exists, omit it from the bindings. Otherwise, include it.

Add the `MovieWrapper` declaration that previously lived in `movies.tsx`:

```tsx
import {
  cacheRegistry,
  definePage,
  Form,
  useAction,
  useLoaderData,
  useOptimisticAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { ComponentType, FunctionComponent } from 'preact';
import { loader, serverActions } from './movie.server.js';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}
```

Update `useLoaderData`:

Replace:
```tsx
const { movie, watched } = useLoaderData(movieLoader);
```

with:
```tsx
const { movie, watched } = useLoaderData<typeof loader>();
```

Replace the default export:

```tsx
export default MovieDetail;
```

with:

```tsx
export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
```

(Remove the `import { loader as movieLoader }` rename if present — use `loader` directly.)

- [ ] **Step 3: Update `apps/app/src/pages/watched.tsx`**

Top of file — add `definePage`, drop the `as`-rename:

Replace:
```tsx
import {
  cacheRegistry,
  useAction,
  useLoaderData,
  useReload,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import {
  serverActions,
  loader as watchedLoader,
} from './watched.server.js';
```

with:
```tsx
import {
  cacheRegistry,
  definePage,
  useAction,
  useLoaderData,
  useReload,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { cache, loader, serverActions } from './watched.server.js';
```

Update `useLoaderData`:

Replace:
```tsx
const { entries } = useLoaderData(watchedLoader);
```

with:
```tsx
const { entries } = useLoaderData<typeof loader>();
```

Replace the default export:

```tsx
export default WatchedPage;
```

with:

```tsx
export default definePage(WatchedPage, { loader, cache });
```

- [ ] **Step 4: Update `apps/app/src/iso.tsx`**

Replace contents of the central route table — drop all `.server.js` imports and all `loader=`/`cache=` props. Keep `fallback` props (route-level).

Full new contents of `apps/app/src/iso.tsx`:

```tsx
import type { ComponentType, FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from '@hono-preact/iso';
import { Route as IsoRoute } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));

const mdxModules = import.meta.glob('./pages/docs/*.mdx');
const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => {
  const route = ('/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''))
    .replace(/\/index$/, '') || '/docs';
  const Component = lazy(async () => {
    const [mod, { DocsLayout }] = await Promise.all([
      (load as () => Promise<{ default: ComponentType }>)(),
      import('./components/DocsLayout.js'),
    ]);
    const MDX = mod.default;
    const Wrapped: ComponentType = (props) => <DocsLayout><MDX {...props} /></DocsLayout>;
    return { default: Wrapped };
  });
  return { route, Component };
});

function onRouteChange() {
  if (!document.startViewTransition) return;
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  return (
    <Router onRouteChange={onRouteChange}>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/*" component={Movies} />
      <Route
        path="/watched"
        component={Watched}
        fallback={<p class="p-1">Loading watched list…</p>}
      />
      {mdxRoutes.map(({ route, Component }) => (
        <IsoRoute path={route} component={Component} />
      ))}
      <NotFound />
    </Router>
  );
};
```

- [ ] **Step 5: Build and TypeScript-check the app**

```bash
pnpm --filter app build
```

Expected: clean build. If the build fails for unused-import reasons (e.g., a leftover `WrapperProps` import), drop the import.

```bash
cd apps/app && npx tsc --noEmit && cd -
```

Expected: clean.

- [ ] **Step 6: Run the full repo test suite**

```bash
pnpm test
```

Expected: all green. The iso package tests pass from previous tasks; the app build is clean.

- [ ] **Step 7: Dev-server smoke test**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
for path in / /test /movies /movies/1241982 /watched /docs /docs/quick-start; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5173$path")
  bytes=$(curl -s "http://localhost:5173$path" | wc -c)
  echo "$path → HTTP $status, $bytes bytes"
done
pkill -f "vite --force" 2>/dev/null || true
```

Expected: every route returns HTTP 200 with substantial content (>1 KB).

- [ ] **Step 8: Manual browser smoke test**

Open `http://localhost:5173/movies`, then click into a movie, click "Mark watched", click "Refresh." DevTools console must be free of `ReferenceError`, `useLoaderData must be called inside…` errors, and 500s.

Specifically verify:
- Initial load — page renders with movies list.
- Click a movie → /movies/:id loads, MovieWrapper's `<article>` element wraps the page (inspect DOM).
- "Mark watched" optimistic update fires + reload completes without console error.
- Navigate to /watched — page renders with entries; bulk-import streaming still works.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/pages/movies.tsx apps/app/src/pages/movie.tsx apps/app/src/pages/watched.tsx apps/app/src/iso.tsx
git commit -m "refactor(app): migrate pages to definePage, drop .server.* imports from iso.tsx"
```

---

## Task 6: Update docs MDX

**Why:** The MDX docs in `apps/app/src/pages/docs/*.mdx` describe the old `useLoaderData(ref)` and `<Route loader={...}>` patterns. After Task 5 these are wrong.

**Files:**
- Modify: each MDX file in `apps/app/src/pages/docs/` that mentions `useLoaderData(` or `<Route` with a `loader=` prop.

- [ ] **Step 1: Find every doc reference to the old patterns**

```bash
grep -rln "useLoaderData(" apps/app/src/pages/docs/
grep -rln "loader=" apps/app/src/pages/docs/
grep -rln "Wrapper=" apps/app/src/pages/docs/
```

The expected hit list (from initial exploration) includes: `index.mdx`, `quick-start.mdx`, `loaders.mdx`, `actions.mdx`, `optimistic-ui.mdx`, `reloading.mdx`, `guards.mdx`, `structure.mdx`.

- [ ] **Step 2: Update each file's code samples**

For every code block:
- `useLoaderData(loaderRef)` → `useLoaderData<typeof loaderRef>()` (with a comment explaining the type-only style if it aids comprehension)
- `<Route ... loader={x}>` → `<Route ... component={x}>` and a sibling sample showing `definePage(Component, { loader, cache })`
- `<Route ... Wrapper={x}>` → fold into `definePage`

Also update prose text where it describes the API. Aim for accuracy over surgical minimalism — if a paragraph discusses the old refId check, rewrite it; do not leave stale guidance.

Add a short section to `loaders.mdx` (or wherever route-level concepts are introduced) titled "Page bindings with `definePage`" that documents:
- `definePage(Component, { loader, cache, Wrapper })`
- bindings live with the page, not with `<Route>`
- argument-free `useLoaderData<typeof loader>()` pattern
- nested routers: bindings always live with the page being mounted

Cross-check the resulting MDX renders by running `pnpm dev` and visiting `/docs/loaders` etc. (already covered by Task 5 step 7).

- [ ] **Step 3: Run the test suite once more**

```bash
pnpm test
```

Expected: green.

- [ ] **Step 4: Build the app**

```bash
pnpm --filter app build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/
git commit -m "docs: update for definePage and argument-free useLoaderData"
```

---

## Task 7: Final verification

**Why:** The same kind of holistic check the previous reviewer did before merging. No code changes — verification only.

- [ ] **Step 1: Clean working tree + full test run**

```bash
git status                            # clean
pnpm test                             # all green
pnpm --filter app build               # clean
cd apps/app && npx tsc --noEmit && cd -  # clean
```

- [ ] **Step 2: Inspect client bundles for `.server.ts` content (no leak regression)**

The `serverOnlyPlugin` should still strip every `.server.*` import from client bundles. Quick sanity:

```bash
grep -r "Moana 2" apps/app/dist/static/ 2>/dev/null && echo "LEAK" || echo "OK: TMDB seed not in client"
grep -r "markWatched" apps/app/dist/static/ 2>/dev/null && echo "LEAK" || echo "OK: markWatched not in client"
grep -r "listWatched" apps/app/dist/static/ 2>/dev/null && echo "LEAK" || echo "OK: listWatched not in client"
```

Expected: all "OK".

- [ ] **Step 3: Inspect a page chunk for `definePage`**

```bash
grep -l "PAGE_BINDINGS\|@hono-preact/iso/page-bindings" apps/app/dist/static/*.js | head -5
```

Expected: at least one file matches — the page chunks should reference the symbol by realm key.

- [ ] **Step 4: Manual smoke test in a real browser**

Open `http://localhost:5173/` after `pnpm dev`. Click through:
- `/` (Home) — renders, no loader
- `/movies` — list loads, "Mark watched" works
- `/movies/:id` — detail page, MovieWrapper `<article>` is in the DOM, notes form submits, photo upload works
- `/watched` — list, bulk-import streaming progresses
- `/docs/loaders` — doc page renders the new examples

DevTools console must be free of any `useLoaderData` errors or `ReferenceError`s.

- [ ] **Step 5: Open the PR**

Suggested title: `feat(iso): page-owned route bindings via definePage`

Body should link the spec at `docs/superpowers/specs/2026-04-30-define-page-design.md` and summarize the breaking-change shape:
- `<Route>` no longer accepts `loader`/`cache`/`Wrapper` props (call sites migrate to `definePage`).
- `useLoaderData(ref)` → `useLoaderData<typeof ref>()` (argument-free).
- `lazy()` is now exported from `@hono-preact/iso`'s own wrapper (still re-exports preact-iso behavior for component rendering).

---

## Out of scope (NOT in this plan)

- **Generated route types** for `useLoaderData()` to infer without `<typeof loader>`. Spec explicitly defers; revisit when the migration has soaked.
- **Auto-pairing of `.tsx` and `.server.ts` files** via Vite. Rejected during brainstorming.
- **Nested-router cleanup** (the duplicate `<Route path="/movies">` and `<Route path="/movies/*">` declarations). Separate concern.
- **Migrating `serverGuards`/`clientGuards`/`actionGuards` into `definePage`.** They could plausibly move; deferred.
- **Backward-compat shim** for `<Route loader={x}>`. Single-commit cutover; no compat layer.
