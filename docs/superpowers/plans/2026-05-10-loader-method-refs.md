# Loader & Action Method Refs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `useLoaderData<typeof loader>()` and `cacheRegistry.invalidate('name')` with methods on the loader/action refs themselves: `loader.useData()`, `loader.invalidate()`, `useAction({ invalidate: [loaderRef, ...] })`, and `stub.useAction(opts)`. Drop the dead surface (`useLoaderData`, `cacheRegistry`, the string-key arg to `createCache`, and the `cache` named export from `.server.ts` modules) so the framework's data story is end-to-end typed without `typeof` gymnastics or stringly-typed names.

**Architecture:**
- Every `LoaderRef<T>` carries a `cache: LoaderCache<T>` (auto-created by `defineLoader` if not supplied) plus `useData()` and `invalidate()` methods. `useData()` reads the existing `LoaderDataContext`; `invalidate()` clears the attached cache. The internal `<Loader>` reads `loader.cache` directly instead of merging an external binding with `loader.cache`.
- `useAction({ invalidate })` accepts `LoaderRef[]` instead of `string[]`. Each ref gets `.invalidate()` called on success.
- `defineAction` now returns a stub that carries a `useAction(opts)` method alongside the existing `__module`/`__action` markers. The server-only Vite plugin's client-side Proxy returns this richer stub shape.
- `cacheRegistry` is deleted (`.register`, `.invalidate`, `.acquire`). `createCache()` no longer accepts a name. `useLoaderData` is deleted. `cache` is no longer an allowed named export from `.server.*` files; the loader auto-creates one.

**Tech Stack:** TypeScript, Preact (`useState`, `useContext`), preact-iso, MagicString + `@babel/parser` (the existing serverOnlyPlugin's tooling), Vitest.

**Out of scope for this plan (separate plans cover them):**
- Spec items 3–8 (`defineApp()`, framework-provided client entry, streaming-loader parity, single guards list, package consolidation, README/launch).
- The modularity backlog from PR #12's deep review (server-only.ts split, path-join consolidation, validation-rule table, `@babel/traverse`, `routeServerModules` shape).
- The pre-existing TS errors in `apps/app/src/pages/movie.server.ts` (TS6133 unused `Movie`, TS6133 unused `WatchedRecord`, TS7031 implicit-any `location`). They'll start failing the build mid-plan because Task 8 removes `cache` from `.server.ts` allowed exports, so they're addressed inline as part of demo migration tasks.
- Cross-package shared caches via `defineLoader(fn, { cache: shared })`. Designable but no current call site needs it; defer until one surfaces.

---

## File Map

**Modify (framework):**
- `packages/iso/src/define-loader.ts` — `LoaderRef<T>` adds `cache: LoaderCache<T>` (required), `useData(): T`, `invalidate(): void`. `defineLoader` auto-creates a cache.
- `packages/iso/src/cache.ts` — drop the `name` arg from `createCache`. Remove the `cacheRegistry.register(...)` call. Drop the `cacheRegistry` import.
- `packages/iso/src/action.ts` — `UseActionOptions.invalidate` becomes `'auto' | false | LoaderRef<unknown>[]`. The mutate body iterates refs and calls `.invalidate()`. `defineAction` returns a stub with `__module`, `__action`, plus `useAction(opts)` — set up on the stub object once `serverOnlyPlugin` rewrites it (the SSR-side stub is just `fn`; method form lives on the client Proxy).
- `packages/iso/src/optimistic-action.ts` — `UseOptimisticActionOptions.invalidate` matches `useAction`'s new shape.
- `packages/iso/src/internal/loader.tsx` — drop `cache?` prop and the `cache ?? loader.cache` merge. Use `loader.cache` directly.
- `packages/iso/src/page.tsx` — drop `cache` from `PageProps`.
- `packages/iso/src/define-page.tsx` — drop `cache` from `PageBindings`.
- `packages/iso/src/index.ts` — remove `useLoaderData` and `cacheRegistry` exports.
- `packages/vite/src/server-only.ts` — update the `loader` import stub to attach a cache + `useData` + `invalidate` methods. Update the `serverActions` Proxy to return stubs with a `useAction` method. Drop the `cache` import-stub branch entirely (forbidden export now). Drop the `cacheRegistry`/`createCache` cache-import-prepend block.
- `packages/vite/src/server-loader-validation.ts` — remove `cache` from the allowed-named-exports list.

**Delete:**
- `packages/iso/src/use-loader-data.ts`
- `packages/iso/src/cache-registry.ts`
- `packages/iso/src/__tests__/cache-registry.test.ts`
- `apps/app/src/pages/movies-list.server.ts` — delete the `export const cache = ...` line (the file stays).
- `apps/app/src/pages/watched.server.ts` — delete the `export const cache = ...` line (the file stays).

**Modify (demo):**
- `apps/app/src/pages/movies-list.tsx` — `useLoaderData<typeof loader>()` → `loader.useData()`. Drop `cache` import. Drop `cache` from `definePage` bindings. `cacheRegistry.invalidate('watched')` → `useAction({ invalidate: [watchedLoader] })`.
- `apps/app/src/pages/movie.tsx` — same migration; multi-invalidate becomes `[moviesListLoader, watchedLoader]`.
- `apps/app/src/pages/watched.tsx` — same migration; cross-page invalidate to `moviesListLoader`. Drop `cache` import.
- `apps/app/src/pages/movies-list.server.ts` — drop the `export const cache = createCache<...>('movies-list')` line.
- `apps/app/src/pages/watched.server.ts` — drop the `export const cache = createCache<...>('watched')` line.
- `apps/app/src/pages/movie.server.ts` — drive-by fix for the three pre-existing TS errors that will block the build once Task 8 changes the validation surface (remove unused `Movie`/`WatchedRecord` imports, type the `location` parameter).

**Modify (tests):**
- `packages/iso/src/__tests__/cache.test.ts` — drop name-keyed assertions; cover unnamed `createCache()` only.
- `packages/iso/src/__tests__/define-loader.test.ts` — add tests for `loader.useData()`, `loader.invalidate()`, auto-cache attachment.
- `packages/iso/src/__tests__/action.test.tsx` — replace `invalidate: ['name']` assertions with `invalidate: [loaderRef]`. Add `stub.useAction(opts)` test.
- `packages/iso/src/__tests__/optimistic-action.test.tsx` — same migration of invalidate type.
- `packages/iso/src/__tests__/define-page.test.tsx` — drop tests for the `cache` binding.
- `packages/iso/src/__tests__/page.test.tsx` — same.
- `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts` — remove tests that allow `cache` as a named export; add a test that flags it as forbidden.
- `packages/vite/src/__tests__/server-only-plugin.test.ts` — replace tests for the `cache` import stub with tests for the new `loader` stub shape (carries cache + methods) and the new `serverActions` Proxy shape (stubs carry `useAction`).
- Delete: `packages/iso/src/__tests__/cache-registry.test.ts`.

---

## Type Reference

```ts
// packages/iso/src/define-loader.ts
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';

export type LoaderCtx = { location: RouteHook };
export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  useData(): T;
  invalidate(): void;
}

export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  cache?: LoaderCache<T>;
};
```

```ts
// packages/iso/src/action.ts
import type { LoaderRef } from './define-loader.js';

export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
  useAction<TSnapshot = unknown>(
    options?: UseActionOptions<TPayload, TResult, TSnapshot>
  ): UseActionResult<TPayload, TResult>;
};

export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onMutate?: (payload: TPayload) => TSnapshot;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  onChunk?: (chunk: string) => void;
};
```

---

## Task 1: Auto-attach a cache to every `LoaderRef` and add `useData` / `invalidate` methods

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/cache.ts` (only to drop the optional `name` arg's reliance on the registry — keep the arg for now to keep the build green; remove in Task 7)
- Modify: `packages/iso/src/__tests__/define-loader.test.ts`

- [ ] **Step 1: Append failing tests**

Add these to the bottom of `packages/iso/src/__tests__/define-loader.test.ts` (keep the existing tests):

```ts
import { LoaderDataContext } from '../internal/contexts.js';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render } from '@testing-library/preact';

describe('LoaderRef methods', () => {
  it('attaches a cache to every loader by default', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    expect(loader.cache).toBeDefined();
    expect(typeof loader.cache.get).toBe('function');
    expect(typeof loader.cache.invalidate).toBe('function');
  });

  it('uses the cache passed in opts when provided', () => {
    const shared = createCache<{ value: number }>();
    const loader = defineLoader(async () => ({ value: 1 }), { cache: shared });
    expect(loader.cache).toBe(shared);
  });

  it('invalidate() clears the loader cache', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    loader.cache.set({ value: 1 });
    expect(loader.cache.has()).toBe(true);
    loader.invalidate();
    expect(loader.cache.has()).toBe(false);
  });

  it('useData() returns the data from LoaderDataContext', () => {
    const loader = defineLoader(async () => ({ value: 42 }));
    const Probe = () => {
      const data = loader.useData();
      return h('span', null, JSON.stringify(data));
    };
    const { container } = render(
      h(LoaderDataContext.Provider, { value: { data: { value: 42 } } }, h(Probe, null))
    );
    expect(container.textContent).toBe('{"value":42}');
  });

  it('useData() throws when called outside a LoaderDataContext', () => {
    const loader = defineLoader(async () => ({ value: 1 }));
    expect(() => {
      const Probe = () => {
        loader.useData();
        return null;
      };
      render(h(Probe, null));
    }).toThrow(/inside a route page/);
  });
});
```

If the test file does not already have a `// @vitest-environment happy-dom` directive at the top, add it (matches sibling test files that render).

If the test file does not already import `createCache`, add it: `import { createCache } from '../cache.js';`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-loader.test.ts`
Expected: FAIL — `loader.cache`, `loader.invalidate`, `loader.useData` are undefined.

- [ ] **Step 3: Implement the new shape**

Replace `packages/iso/src/define-loader.ts` with:

```ts
import { useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { createCache, type LoaderCache } from './cache.js';
import { LoaderDataContext } from './internal/contexts.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  useData(): T;
  invalidate(): void;
}

/**
 * Plugin-emitted opts for `defineLoader`. The `__moduleKey` field is threaded
 * in by the `moduleKeyPlugin` Vite transform; user code does not set it.
 * `cache` is an opt-in for sharing a cache instance across multiple loaders;
 * when omitted, `defineLoader` creates a fresh one.
 */
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  cache?: LoaderCache<T>;
};

export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  const __id = opts?.__moduleKey
    ? Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`)
    : Symbol(`@hono-preact/loader:<unkeyed>`);
  const cache = opts?.cache ?? createCache<T>();

  const ref: LoaderRef<T> = {
    __id,
    fn,
    cache,
    useData() {
      const ctx = useContext(LoaderDataContext);
      if (!ctx) {
        throw new Error(
          'loader.useData() must be called inside a route page that has a loader.'
        );
      }
      return ctx.data as T;
    },
    invalidate() {
      cache.invalidate();
    },
  };
  return ref;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/define-loader.test.ts`
Expected: PASS — both existing and new tests.

- [ ] **Step 5: Verify no regressions in adjacent tests**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso`
Expected: all pass. The `internal/loader.tsx` still reads `cache ?? loader.cache` (the prop is optional today and `loader.cache` is now always populated, so behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader.test.ts
git commit -m "feat(iso): LoaderRef carries cache, useData, invalidate methods"
```

---

## Task 2: Update `<Loader>` to read `loader.cache` directly

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/define-page.tsx`
- Modify: `packages/iso/src/__tests__/define-page.test.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`

The `cache` prop on `<Loader>` and `<Page>` and `definePage`'s `PageBindings` is now redundant: every `LoaderRef` carries its own cache. Drop the prop and the merge.

- [ ] **Step 1: Update `internal/loader.tsx`**

In `packages/iso/src/internal/loader.tsx`, change `LoaderProps<T>` and `LoaderHostProps<T>`:

```tsx
type LoaderProps<T> = {
  loader: LoaderRef<T>;
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

export function Loader<T>({ loader, location, fallback, children }: LoaderProps<T>) {
  const id = useId();
  return (
    <LoaderIdContext.Provider value={id}>
      <LoaderHost
        loaderRef={loader}
        location={location}
        id={id}
        fallback={fallback}
      >
        {children}
      </LoaderHost>
    </LoaderIdContext.Provider>
  );
}

type LoaderHostProps<T> = {
  loaderRef: LoaderRef<T>;
  location: RouteHook;
  id: string;
  fallback?: JSX.Element;
  children: ComponentChildren;
};

function LoaderHost<T>({
  loaderRef,
  location,
  id,
  fallback,
  children,
}: LoaderHostProps<T>) {
  // ... existing body, but replace every `cache` reference with `loaderRef.cache`
```

In the body of `LoaderHost`, every reference to the destructured `cache` variable becomes `loaderRef.cache` (4 sites: in `runReload`'s `.then`, in the conditional that reads `cache.has()` / `cache.get()` / `cache.set()`, and in the wrapPromise `.then`). Remove the `cache` parameter.

Drop the `import type { LoaderCache } from '../cache.js'` line if it becomes unused.

- [ ] **Step 2: Update `page.tsx`**

In `packages/iso/src/page.tsx`, remove `cache` from `PageProps<T>` and from the `<Loader>` invocation:

```tsx
export type PageProps<T> = {
  loader?: LoaderRef<T>;
  location: RouteHook;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  Wrapper?: ComponentType<WrapperProps>;
  children: ComponentChildren;
};

export function Page<T>({
  loader,
  location,
  serverGuards,
  clientGuards,
  fallback,
  errorFallback,
  Wrapper,
  children,
}: PageProps<T>): JSX.Element {
  const id = useId();
  return (
    <RouteBoundary fallback={fallback} errorFallback={errorFallback}>
      <Guards server={serverGuards} client={clientGuards} location={location}>
        {loader ? (
          <Loader loader={loader} location={location} fallback={fallback}>
            <Envelope as={Wrapper}>{children}</Envelope>
          </Loader>
        ) : (
          <NoLoaderFrame id={id} as={Wrapper}>
            {children}
          </NoLoaderFrame>
        )}
      </Guards>
    </RouteBoundary>
  );
}
```

Drop the `import type { LoaderCache } from './cache.js'` line.

- [ ] **Step 3: Update `define-page.tsx`**

In `packages/iso/src/define-page.tsx`, remove `cache` from `PageBindings`:

```tsx
export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  Wrapper?: ComponentType<WrapperProps>;
  fallback?: JSX.Element;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

export function definePage<T>(
  Component: ComponentType,
  bindings?: PageBindings<T>
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page<T>
      loader={bindings?.loader}
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

Drop the `import type { LoaderCache } from './cache.js'` line.

- [ ] **Step 4: Update `__tests__/define-page.test.tsx` and `__tests__/page.test.tsx`**

Search both test files for `cache:` in any `definePage(...)` or `<Page ... cache={...}>` call. Remove every `cache` binding/prop. If a test was specifically asserting that `cache` is wired through the binding (i.e., a "the binding's cache reaches the Loader" test), delete the test outright — the new model attaches cache to the loader directly, so this assertion is now meaningless.

The test files are large; the easiest verification is to grep:

```bash
grep -n "\bcache\b" packages/iso/src/__tests__/define-page.test.tsx packages/iso/src/__tests__/page.test.tsx
```

Each match must be either dropped, or changed to use `defineLoader(fn, { cache })` to attach the cache via the loader instead of the binding.

- [ ] **Step 5: Run tests**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/page.tsx packages/iso/src/define-page.tsx packages/iso/src/__tests__/define-page.test.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "refactor(iso): drop cache binding from <Page>/definePage; use loader.cache"
```

---

## Task 3: `useAction` accepts `LoaderRef[]` for `invalidate`

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/iso/src/optimistic-action.ts`
- Modify: `packages/iso/src/__tests__/action.test.tsx`
- Modify: `packages/iso/src/__tests__/optimistic-action.test.tsx`

Both string-array and ref-array forms work for the duration of the migration. Tasks 7 and 8 drop the string form.

- [ ] **Step 1: Append failing test**

Add to `packages/iso/src/__tests__/action.test.tsx` inside whatever existing `describe('useAction', ...)` block exists:

```tsx
it('calls .invalidate() on each loader ref after a successful mutation', async () => {
  const a = defineLoader(async () => ({ a: 1 }));
  const b = defineLoader(async () => ({ b: 2 }));
  a.cache.set({ a: 1 });
  b.cache.set({ b: 2 });
  expect(a.cache.has()).toBe(true);
  expect(b.cache.has()).toBe(true);

  // Stub a successful action response.
  const stub = { __module: 'm', __action: 'go' } as ActionStub<{}, { ok: true }>;
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch;

  const Probe = () => {
    const { mutate } = useAction(stub, { invalidate: [a, b] });
    React.useEffect(() => {
      mutate({});
    }, [mutate]);
    return null;
  };
  render(h(Probe, null));

  // Yield until the fetch + post-success path completes.
  await vi.waitFor(() => {
    expect(a.cache.has()).toBe(false);
    expect(b.cache.has()).toBe(false);
  });
});
```

Add the imports the test needs to the file's existing import list: `defineLoader`, `vi`, `vi.waitFor`, `React.useEffect` (or the preact equivalent — match the test file's existing patterns; if the file already does direct preact `useEffect` imports, follow that). If the file already mocks `fetch` differently, fold into that pattern.

- [ ] **Step 2: Run tests to verify it fails**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso/src/__tests__/action.test.tsx -t "loader ref"`
Expected: FAIL — current code treats `[a, b]` as `string[]` and calls `cacheRegistry.invalidate(a)` which is a no-op for object args.

- [ ] **Step 3: Update `action.ts`**

Replace the `UseActionOptions` invalidate type and the mutate body's invalidate handling:

```ts
import type { LoaderRef } from './define-loader.js';

export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  onMutate?: (payload: TPayload) => TSnapshot;
  onError?: (err: Error, snapshot: TSnapshot) => void;
  onSuccess?: (data: TResult, snapshot: TSnapshot) => void;
  onChunk?: (chunk: string) => void;
};
```

In the `mutate` body, replace the invalidate dispatch:

```ts
if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload();
} else if (Array.isArray(currentOptions?.invalidate)) {
  for (const ref of currentOptions.invalidate) {
    ref.invalidate();
  }
}
```

Drop the `import { cacheRegistry } from './cache-registry.js'` line.

- [ ] **Step 4: Update `optimistic-action.ts`**

Mirror the type change in `UseOptimisticActionOptions`:

```ts
import type { LoaderRef } from './define-loader.js';

export type UseOptimisticActionOptions<TPayload, TResult, TBase> = Omit<
  UseActionOptions<TPayload, TResult>,
  'invalidate' | 'onMutate' | 'onError' | 'onSuccess'
> & {
  base: TBase;
  apply: (current: TBase, payload: TPayload) => TBase;
  invalidate?: 'auto' | ReadonlyArray<LoaderRef<unknown>>;
  onSuccess?: (data: TResult) => void;
  onError?: (err: Error) => void;
};
```

(`'auto' | ReadonlyArray<LoaderRef<unknown>>` matches the existing rule that `false` is explicitly disallowed for the optimistic variant.)

- [ ] **Step 5: Update `__tests__/action.test.tsx` and `optimistic-action.test.tsx`**

Search both test files for `invalidate: [` followed by string literals. Each match should be converted to use `LoaderRef[]` instead. The mechanical conversion: define a `defineLoader(...)` for each name string used today, and pass that ref instead.

```bash
grep -n "invalidate:" packages/iso/src/__tests__/action.test.tsx packages/iso/src/__tests__/optimistic-action.test.tsx
```

Walk each match. For tests that exercise the cross-page invalidation behavior (the `cacheRegistry.invalidate(name)` call path), they now exercise `ref.invalidate()` directly. Keep the test's intent; update the call shape.

- [ ] **Step 6: Run all iso tests**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/iso`
Expected: all pass, including the new loader-ref invalidate test.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/optimistic-action.ts packages/iso/src/__tests__/action.test.tsx packages/iso/src/__tests__/optimistic-action.test.tsx
git commit -m "feat(iso): useAction({ invalidate }) accepts LoaderRef[] instead of string[]"
```

---

## Task 4: Demo migration — `loader.useData()` everywhere

**Files:**
- Modify: `apps/app/src/pages/movies-list.tsx`
- Modify: `apps/app/src/pages/movie.tsx`
- Modify: `apps/app/src/pages/watched.tsx`

Drop-in replacement: `useLoaderData<typeof loader>()` → `loader.useData()`. The data is the same; the call site no longer carries a generic.

- [ ] **Step 1: `movies-list.tsx`**

Change:

```tsx
import {
  cacheRegistry,
  definePage,
  useLoaderData,
  useOptimisticAction,
} from '@hono-preact/iso';
// ...
const { movies, watchedIds } = useLoaderData<typeof loader>();
```

to:

```tsx
import {
  cacheRegistry,
  definePage,
  useOptimisticAction,
} from '@hono-preact/iso';
// ...
const { movies, watchedIds } = loader.useData();
```

- [ ] **Step 2: `movie.tsx`**

Change:

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
// ...
const { movie, watched, watchedCount } = useLoaderData<typeof loader>();
```

to:

```tsx
import {
  cacheRegistry,
  definePage,
  Form,
  useAction,
  useOptimisticAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
// ...
const { movie, watched, watchedCount } = loader.useData();
```

- [ ] **Step 3: `watched.tsx`**

Change:

```tsx
import {
  cacheRegistry,
  definePage,
  useAction,
  useLoaderData,
  useReload,
} from '@hono-preact/iso';
// ...
const { entries } = useLoaderData<typeof loader>();
```

to:

```tsx
import {
  cacheRegistry,
  definePage,
  useAction,
  useReload,
} from '@hono-preact/iso';
// ...
const { entries } = loader.useData();
```

- [ ] **Step 4: Build the iso package types and verify the demo**

Run:

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npm run build
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit
```

Expected: only the 3 pre-existing `movie.server.ts` errors. No errors related to `useLoaderData` or `loader.useData` in the migrated pages.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-list.tsx apps/app/src/pages/movie.tsx apps/app/src/pages/watched.tsx
git commit -m "feat(app): migrate demo from useLoaderData to loader.useData()"
```

---

## Task 5: Demo migration — ref-based invalidation

**Files:**
- Modify: `apps/app/src/pages/movies-list.tsx`
- Modify: `apps/app/src/pages/movie.tsx`
- Modify: `apps/app/src/pages/watched.tsx`

`cacheRegistry.invalidate('name')` and `useAction({ invalidate: ['name'] })` both go away in favour of `useAction({ invalidate: [refs] })`. For sites that previously called `cacheRegistry.invalidate('x')` from inside `onSuccess`, fold them into the `invalidate: [...]` array on `useAction`/`useOptimisticAction`. Where that's awkward (e.g. an effect outside an action call), use `xLoader.invalidate()` directly.

- [ ] **Step 1: `movies-list.tsx`**

Add the watched loader import:

```tsx
import { loader as watchedLoader } from './watched.server.js';
```

Change the `useOptimisticAction` block:

```tsx
const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
  serverActions.toggleWatched,
  {
    base: watchedIds,
    apply: (current, payload) =>
      payload.watched
        ? [...current, payload.movieId]
        : current.filter((id) => id !== payload.movieId),
    invalidate: ['auto', watchedLoader],
    // (was: invalidate: 'auto', onSuccess: () => cacheRegistry.invalidate('watched'))
  }
);
```

Wait — `invalidate` is `'auto' | LoaderRef[]`, not a mix. To preserve both behaviors (re-fetch the page's own loader + invalidate `watchedLoader`), pass an array containing both `loader` and `watchedLoader`:

```tsx
invalidate: [loader, watchedLoader],
```

`'auto'` was a shortcut for "the page's own loader." Replacing it with the explicit ref makes the intent clear.

Drop the `cacheRegistry` import from the `@hono-preact/iso` import list.

- [ ] **Step 2: `movie.tsx`**

Apply the same pattern:

```tsx
import { loader as moviesListLoader } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
```

Update each `useAction`/`useOptimisticAction` call: replace `invalidate: 'auto'` + `cacheRegistry.invalidate('...')` calls in `onSuccess` with explicit ref arrays. The three sites in `movie.tsx`:

- `NotesForm`'s `useAction(serverActions.setNotes, { invalidate: 'auto', onSuccess: () => cacheRegistry.invalidate('watched') })` → `{ invalidate: [loader, watchedLoader] }`.
- `PhotoForm`'s `useAction(serverActions.setPhoto, { invalidate: 'auto', onSuccess: () => cacheRegistry.invalidate('watched') })` → `{ invalidate: [loader, watchedLoader] }`.
- The detail page's `useOptimisticAction(serverActions.toggleWatched, { ..., invalidate: 'auto', onSuccess: () => { cacheRegistry.invalidate('movies-list'); cacheRegistry.invalidate('watched'); } })` → `{ ..., invalidate: [loader, moviesListLoader, watchedLoader] }`.

Drop the `cacheRegistry` import.

- [ ] **Step 3: `watched.tsx`**

Two `useAction` sites; same migration:

```tsx
import { loader as moviesListLoader } from './movies-list.server.js';
```

- `useAction(serverActions.removeWatched, { invalidate: 'auto', onSuccess: () => cacheRegistry.invalidate('movies-list') })` → `{ invalidate: [loader, moviesListLoader] }`.
- `useAction(serverActions.bulkImportWatched, { onChunk: ..., onSuccess: () => { setProgress(null); cacheRegistry.invalidate('movies-list'); reload.reload(); } })` → keep `onSuccess` for the `setProgress(null)` and `reload.reload()` UI work; drop `cacheRegistry.invalidate('movies-list')`. Add `invalidate: [moviesListLoader]` to the options.

Drop the `cacheRegistry` import.

- [ ] **Step 4: Verify**

Run:

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit
```

Expected: tests pass; tsc shows only the pre-existing `movie.server.ts` errors.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-list.tsx apps/app/src/pages/movie.tsx apps/app/src/pages/watched.tsx
git commit -m "feat(app): migrate demo from cacheRegistry strings to loader-ref invalidation"
```

---

## Task 6: Drop `cache` named export from `.server.ts`; loader auto-creates

**Files:**
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Modify: `apps/app/src/pages/watched.server.ts`
- Modify: `apps/app/src/pages/movie.server.ts` (drive-by fix for the 3 pre-existing TS errors)
- Modify: `packages/vite/src/server-loader-validation.ts`
- Modify: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`

- [ ] **Step 1: Drop `cache` export from `movies-list.server.ts`**

Change:

```ts
import { createCache, defineAction, defineLoader } from '@hono-preact/iso';
// ...
export const loader = defineLoader(serverLoader);
export const cache = createCache<{ movies: MoviesData; watchedIds: number[] }>('movies-list');
```

to:

```ts
import { defineAction, defineLoader } from '@hono-preact/iso';
// ...
export const loader = defineLoader(serverLoader);
```

- [ ] **Step 2: Drop `cache` export from `watched.server.ts`**

Change:

```ts
import { createCache, defineAction, defineLoader } from '@hono-preact/iso';
// ...
export const loader = defineLoader(serverLoader);
export const cache = createCache<{ entries: Entry[] }>('watched');
```

to:

```ts
import { defineAction, defineLoader } from '@hono-preact/iso';
// ...
export const loader = defineLoader(serverLoader);
```

- [ ] **Step 3: Fix `movie.server.ts` pre-existing errors**

Open `apps/app/src/pages/movie.server.ts`. Three errors:

```
TS6133: 'Movie' is declared but its value is never read.
TS6133: 'WatchedRecord' is declared but its value is never read.
TS7031: Binding element 'location' implicitly has an 'any' type.
```

Apply minimal fixes:
- Remove the unused `Movie` import: `import type { Movie } from '@/server/data/movie.js';` line goes.
- Remove `WatchedRecord` from the `@/server/watched.js` import (keep the runtime imports).
- Type the `location` parameter on the loader function. The framework's `LoaderCtx` is exported from `@hono-preact/iso`; use it:

```ts
import { defineAction, defineLoader, type LoaderCtx } from '@hono-preact/iso';
// ...
const serverLoader = async ({ location }: LoaderCtx) => { /* ... */ };
```

- [ ] **Step 4: Update `serverLoaderValidationPlugin`**

In `packages/vite/src/server-loader-validation.ts`, find the allowed-named-exports list (look for the array containing `'loader', 'cache', 'serverGuards', 'serverActions', 'actionGuards'` or similar) and remove the `'cache'` entry.

Update the error-message constant in the plugin to match (the message lists allowed exports; remove `cache` from it).

- [ ] **Step 5: Update validation plugin test**

In `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`, find any test that asserts `cache` is allowed and convert it: `cache` should now be REJECTED. If the test was named something like `'allows cache as a named export'`, rename to `'rejects cache as a named export'` and assert the throw with a message that matches the new error.

If the test fixture files contain a `.server.ts` with `export const cache = ...`, update the fixture(s) so the test corpus reflects the new rule. Search:

```bash
grep -rn "export const cache" packages/vite/src/__tests__/
```

- [ ] **Step 6: Update the server-only plugin to drop `cache` import handling**

In `packages/vite/src/server-only.ts`, find the `if (specifier.imported.type === 'Identifier' && specifier.imported.name === 'cache')` branch in the import-specifier handling loop. Replace it with a `throw new Error(...)` matching the format of the surrounding "not a recognized export" error:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'cache'
) {
  throw new Error(
    `${id}: \`cache\` is no longer an allowed export from a *.server.* module. ` +
    `Caches are auto-attached to loaders. To share a cache across loaders, ` +
    `import \`createCache\` from '@hono-preact/iso' and pass it via ` +
    `\`defineLoader(fn, { cache })\`.`
  );
}
```

Also remove the `needsCacheImport` set, the `extractCacheName` helper invocation, the `hashSuffix` use for cache aliases, and the cache-import prepend block at the bottom of the transform. Once the `cache` branch throws, none of that machinery is reachable.

- [ ] **Step 7: Update server-only plugin tests**

In `packages/vite/src/__tests__/server-only-plugin.test.ts`, find tests for the cache-import stub (keywords: `cacheRegistry`, `acquire`, `__cacheRegistry`). Each was asserting the rewriter generated specific text for a `cache` import. They should now assert that an `import { cache } from './x.server.js'` raises the new error.

Also update any test fixture under `packages/vite/src/__tests__/fixtures/` whose source code has `import { ..., cache } from '...'` — either drop the `cache` import or ensure it's the focus of the rejection test.

- [ ] **Step 8: Verify**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run`
Expected: all pass, with cache-related tests now asserting rejection rather than allowance.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit`
Expected: clean — the pre-existing `movie.server.ts` errors are gone now.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build`
Expected: clean client + SSR build.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/pages/movies-list.server.ts apps/app/src/pages/watched.server.ts apps/app/src/pages/movie.server.ts packages/vite/src/server-loader-validation.ts packages/vite/src/server-only.ts packages/vite/src/__tests__/server-loader-validation-plugin.test.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "refactor: drop cache named export from .server modules; loader auto-attaches cache"
```

---

## Task 7: Drop `name` arg from `createCache`; remove `cacheRegistry`

**Files:**
- Modify: `packages/iso/src/cache.ts`
- Modify: `packages/iso/src/__tests__/cache.test.ts`
- Modify: `packages/iso/src/index.ts`
- Delete: `packages/iso/src/cache-registry.ts`
- Delete: `packages/iso/src/__tests__/cache-registry.test.ts`

- [ ] **Step 1: Replace `cache.ts`**

Replace the body with:

```ts
import type { Loader } from './define-loader.js';
import { isBrowser } from './is-browser.js';

export interface LoaderCache<T> {
  get(): T | null;
  set(value: T): void;
  has(): boolean;
  wrap(loader: Loader<T>): Loader<T>;
  invalidate(): void;
}

type RequestStore = Map<symbol, unknown>;

type ALSInstance = {
  getStore(): RequestStore | undefined;
  run<R>(store: RequestStore, fn: () => R): R;
};

let alsInstance: ALSInstance | null = null;
const looksLikeBrowser =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
  typeof (globalThis as { document?: unknown }).document !== 'undefined';
if (!looksLikeBrowser) {
  try {
    const moduleName = 'node:async_hooks';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      AsyncLocalStorage: new () => ALSInstance;
    };
    alsInstance = new mod.AsyncLocalStorage();
  } catch {
    alsInstance = null;
  }
}

function getRequestStore(): RequestStore | undefined {
  return alsInstance?.getStore();
}

export function runRequestScope<R>(fn: () => R | Promise<R>): R | Promise<R> {
  if (!alsInstance) return fn();
  return alsInstance.run(new Map(), fn);
}

export function createCache<T>(): LoaderCache<T> {
  const key = Symbol('cache');
  let fallbackStore: T | null = null;

  function read(): T | null {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        return (reqStore.get(key) as T | undefined) ?? null;
      }
    }
    return fallbackStore;
  }

  function write(value: T | null): void {
    if (!isBrowser()) {
      const reqStore = getRequestStore();
      if (reqStore) {
        if (value === null) reqStore.delete(key);
        else reqStore.set(key, value);
        return;
      }
    }
    fallbackStore = value;
  }

  return {
    get: () => read(),
    set: (value) => write(value),
    has: () => read() !== null,
    wrap(loader) {
      return async (props) => {
        const existing = read();
        if (existing !== null) return existing;
        const result = await loader(props);
        write(result);
        return result;
      };
    },
    invalidate() {
      write(null);
    },
  };
}
```

- [ ] **Step 2: Update `cache.test.ts`**

Search the file for `createCache(` calls passing a string argument. Each should drop the argument. Search for tests that exercised the `cacheRegistry.register` side effect (e.g. `cacheRegistry.invalidate('name')` clearing this cache); delete those — that path is gone.

- [ ] **Step 3: Delete `cache-registry.ts` and its test**

Run:

```bash
git rm packages/iso/src/cache-registry.ts packages/iso/src/__tests__/cache-registry.test.ts
```

- [ ] **Step 4: Update `index.ts`**

Remove the `cacheRegistry` export line:

```ts
export { cacheRegistry } from './cache-registry.js';   // <-- delete this line
```

- [ ] **Step 5: Verify**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run`
Expected: all pass.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/cache.ts packages/iso/src/__tests__/cache.test.ts packages/iso/src/index.ts
git commit -m "refactor(iso): drop createCache name arg; remove cacheRegistry"
```

---

## Task 8: Remove `useLoaderData` from the public surface

**Files:**
- Delete: `packages/iso/src/use-loader-data.ts`
- Modify: `packages/iso/src/index.ts`

- [ ] **Step 1: Delete the file**

```bash
git rm packages/iso/src/use-loader-data.ts
```

- [ ] **Step 2: Remove the export from `index.ts`**

In `packages/iso/src/index.ts`, delete the line:

```ts
export { useLoaderData } from './use-loader-data.js';
```

- [ ] **Step 3: Verify nothing imports `useLoaderData`**

Run:

```bash
grep -rn "useLoaderData" /Users/stevenbeshensky/Documents/repos/hono-preact/packages /Users/stevenbeshensky/Documents/repos/hono-preact/apps 2>/dev/null
```

Expected: no matches. (Task 4 migrated all consumers.)

- [ ] **Step 4: Run all tests + builds**

Run:

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit && npm run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "refactor(iso): remove useLoaderData; loader.useData() is the only path"
```

---

## Task 9: Update server-only plugin's `loader` stub for the new shape

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

The current `loader` import stub on the client looks like:

```js
const ${specifier.local.name} = {
  __id: Symbol.for('@hono-preact/loader:${moduleKey}'),
  fn: ${loaderFetchArrow(moduleKey, '  ')},
};
```

The new `LoaderRef` has `cache`, `useData`, `invalidate`. The client stub must produce a ref carrying all four (plus `__id` and `fn`).

- [ ] **Step 1: Update the loader-import stub generation**

In `packages/vite/src/server-only.ts`, find the branch where `specifier.imported.name === 'loader'` and replace the stubs.push block. The new stub creates the LoaderRef inline using the framework's `defineLoader` helper rather than hand-rolling the object; that way the methods are correctly wired and the cache is auto-attached:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'loader'
) {
  needsLoaderImport = true;
  stubs.push(
    `const ${specifier.local.name} = __$defineLoader_${aliasSuffix}(${loaderFetchArrow(moduleKey, '  ')}, { __moduleKey: ${JSON.stringify(moduleKey)} });`
  );
}
```

Replace the cache-import-prepend block at the bottom with a loader-import-prepend block:

```ts
if (needsLoaderImport) {
  s.prepend(
    `import { defineLoader as __$defineLoader_${aliasSuffix} } from '@hono-preact/iso';\n`
  );
}
```

(Use a single `aliasSuffix` per file rather than per-import-source — pick one suffix and reuse it. Or just use a constant alias since we're prepending once per file. Adjust the logic to track whether ANY loader import in the file needed the alias.)

This keeps the server-side loader semantics (the loader's `fn` is the RPC stub on the client) while picking up the `cache`, `useData`, `invalidate` shape from the framework's own `defineLoader`.

- [ ] **Step 2: Update server-only-plugin tests**

In `packages/vite/src/__tests__/server-only-plugin.test.ts`, find the tests that assert the loader-stub text. They previously asserted strings containing `Symbol.for('@hono-preact/loader:` and `fn: async`. Update to assert the new shape: imports `defineLoader` from `@hono-preact/iso`; calls it with the RPC arrow + `__moduleKey`.

- [ ] **Step 3: Verify**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run packages/vite`
Expected: all pass.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build && grep -l "movies-list.server" apps/app/dist/static/*.js 2>/dev/null && echo LEAK || echo "no leak"`
Expected: app builds; no real `.server.*` import in client bundle (the existing leak check from PR #12).

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "refactor(vite): client-side loader stub uses defineLoader for new ref shape"
```

---

## Task 10: Add `stub.useAction(opts)` method form

**Files:**
- Modify: `packages/iso/src/action.ts`
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/iso/src/__tests__/action.test.tsx`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

The client-side `serverActions` Proxy currently returns `{ __module, __action }` per property. Make it return a richer object with a `useAction(opts)` method.

- [ ] **Step 1: Append failing test**

Add to `packages/iso/src/__tests__/action.test.tsx`:

```tsx
it('exposes useAction as a method on the stub', async () => {
  // A hand-built stub that mimics what the serverOnlyPlugin Proxy produces.
  const stub: ActionStub<{ x: number }, { ok: true }> = {
    __module: 'm',
    __action: 'go',
    useAction(opts) { return useAction(this as ActionStub<{ x: number }, { ok: true }>, opts); },
  };

  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch;

  const captured: Array<{ pending: boolean; data: unknown }> = [];
  const Probe = () => {
    const { mutate, pending, data } = stub.useAction();
    captured.push({ pending, data });
    React.useEffect(() => { mutate({ x: 1 }); }, [mutate]);
    return null;
  };
  render(h(Probe, null));

  await vi.waitFor(() => {
    expect(captured.some((c) => c.data && (c.data as { ok: true }).ok)).toBe(true);
  });
});
```

(Match the test file's existing patterns for fetch mocking and probe-component assertions.)

- [ ] **Step 2: Run the test to verify it fails**

Today's `ActionStub` type does not include `useAction`. The test should fail to type-check or to call.

- [ ] **Step 3: Update the `ActionStub` type and add the runtime method**

Update `packages/iso/src/action.ts`:

```ts
export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
  useAction<TSnapshot = unknown>(
    options?: UseActionOptions<TPayload, TResult, TSnapshot>
  ): UseActionResult<TPayload, TResult>;
};
```

`defineAction` itself remains a runtime no-op on the SERVER side (it returns `fn`); the client-side Proxy is what gets the `useAction` method. The type annotation lets consumers call `stub.useAction(...)` and get correctly-typed results.

- [ ] **Step 4: Update the server-only plugin's `serverActions` Proxy stub**

In `packages/vite/src/server-only.ts`, find the branch where `specifier.imported.name === 'serverActions'`. Replace the Proxy generation:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'serverActions'
) {
  needsUseActionImport = true;
  stubs.push(
    `const ${specifier.local.name} = new Proxy({}, {\n` +
    `  get(_, action) {\n` +
    `    const stub = { __module: ${JSON.stringify(moduleKey)}, __action: String(action) };\n` +
    `    stub.useAction = (opts) => __$useAction_${aliasSuffix}(stub, opts);\n` +
    `    return stub;\n` +
    `  }\n` +
    `});`
  );
}
```

Add a `useAction` import alongside the existing imports prepend:

```ts
if (needsUseActionImport) {
  s.prepend(
    `import { useAction as __$useAction_${aliasSuffix} } from '@hono-preact/iso';\n`
  );
}
```

(Coordinate with Task 9's loader-import prepend so both prepends fire when needed.)

- [ ] **Step 5: Update server-only-plugin tests**

The Proxy-stub test now asserts the new shape. Update assertions accordingly.

- [ ] **Step 6: Verify**

Run all tests + the app build + leak check:

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build
grep -l "movies-list.server" apps/app/dist/static/*.js 2>/dev/null && echo LEAK || echo "no leak"
```

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/action.ts packages/vite/src/server-only.ts packages/iso/src/__tests__/action.test.tsx packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(iso): action stubs expose useAction(opts) method"
```

---

## Task 11: Update docs to reflect the new surface

**Files:**
- Modify: `apps/app/src/pages/docs/loaders.mdx`
- Modify: `apps/app/src/pages/docs/actions.mdx`
- Modify: `apps/app/src/pages/docs/loading-states.mdx`
- Modify: `apps/app/src/pages/docs/reloading.mdx`
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/index.mdx`
- Modify: `apps/app/src/pages/docs/quick-start.mdx`
- Modify: `apps/app/src/pages/docs/optimistic-ui.mdx`

Per the `keep-docs-fresh` skill at `.claude/skills/keep-docs-fresh.md`: docs ship in the same commit as the code change. This task is a single sweep across every doc page that mentions removed/changed APIs.

- [ ] **Step 1: Grep for stale references**

```bash
grep -rn "useLoaderData\|cacheRegistry\|createCache.*'.*'\|invalidate:\s*\['" apps/app/src/pages/docs/
```

For each match, choose the right replacement:
- `useLoaderData<typeof loader>()` → `loader.useData()`
- `cacheRegistry` references in prose → "named loader refs" / "loader.invalidate()"
- `createCache<T>('name')` → `createCache<T>()` (named caches are gone)
- `invalidate: ['name', ...]` → `invalidate: [loaderRef, ...]`
- `cache` named export examples in `.server.ts` snippets → drop them; the loader auto-attaches a cache

- [ ] **Step 2: Walk each file**

For each MDX file flagged by the grep, edit prose AND code blocks. The conversation that produced this plan has the full context for the spec-level reasoning; refer to spec section 2 for the canonical replacement vocabulary.

Specifically, update:

- **`loaders.mdx`** — the central page on this topic. Update the file-pair example, the cross-page invalidation section, the named-cache section (which becomes a "shared cache" section using `defineLoader(fn, { cache })`), and the consumer-side useLoaderData snippet.
- **`actions.mdx`** — the `invalidate` table column entries. The cross-page invalidation snippet. Add a note about `stub.useAction(opts)` as an alternative call form.
- **`loading-states.mdx`** — replace the `useLoaderData` consumer snippet with `loader.useData()`.
- **`reloading.mdx`** — same.
- **`structure.mdx`** — drop the `cacheRegistry` mention from the `@hono-preact/iso` package summary.
- **`index.mdx`** — main code example uses `loader.useData()`.
- **`quick-start.mdx`** — same.
- **`optimistic-ui.mdx`** — `invalidate` examples and any `useLoaderData` snippets.

- [ ] **Step 3: Verify**

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && grep -rn "useLoaderData\|cacheRegistry" apps/app/src/pages/docs/ | head`
Expected: no matches (modulo intentional historical references — none expected).

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run`
Expected: all pass.

Run: `cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/pages/docs/
git commit -m "docs: rewrite for loader.useData()/loader.invalidate() and ref-based invalidation"
```

---

## Task 12: Final verification

**Files:** None modified.

- [ ] **Step 1: Type-check the whole repo**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/server && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/packages/vite && npx tsc --noEmit
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npx tsc --noEmit
```

Expected: all clean. Notably, the 3 pre-existing `movie.server.ts` errors fixed in Task 6 should no longer appear.

- [ ] **Step 2: Full test suite**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact && npx vitest run
```

Expected: all pass. Net delta: +2 tests for loader.useData/invalidate, +1 for stub.useAction, -N for deleted cacheRegistry tests.

- [ ] **Step 3: App build + bundle leak check**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && rm -rf dist && npm run build
grep -lE "import\s*\(\s*['\"][^'\"]*\.server\.[jt]sx?['\"]" apps/app/dist/static/*.js && echo LEAK || echo "no leak"
```

Expected: clean client + SSR build; no real server import in client bundle.

- [ ] **Step 4: Public surface assertion**

```bash
grep -E "^export" /Users/stevenbeshensky/Documents/repos/hono-preact/packages/iso/src/index.ts | grep -E "useLoaderData|cacheRegistry"
```

Expected: no matches. (The two removals are gone from the public surface.)

- [ ] **Step 5: Manual smoke (only if dev server can be started without external deps)**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/apps/app && npm run dev
```

Manually verify in a browser:
- `/movies` — list renders, watched count updates as you toggle, filter input works.
- `/movies/123` — detail renders, toggle updates count, layout chrome stays mounted.
- `/watched` — list renders; remove button invalidates the movies list.
- A 404 (`/nonsense`) — not-found page.

Stop the dev server.

- [ ] **Step 6: No commit needed unless smoke testing surfaced fixes**

If smoke testing surfaced fixes, commit them with a clear message; otherwise the prior tasks already shipped working state.

---

## Self-Review

1. **Spec coverage.** Spec section 2 lists three concrete API additions and three concrete deletions:
   - ✅ `loader.useData()` — Task 1.
   - ✅ `loader.invalidate()` — Task 1.
   - ✅ `useAction({ invalidate: [refs] })` — Task 3.
   - ✅ `stub.useAction(opts)` — Task 10.
   - ✅ Drop `useLoaderData<typeof loader>()` — Task 8.
   - ✅ Drop `cacheRegistry` (`.register`/`.invalidate`/`.acquire`) — Task 7.
   - ✅ Drop `'movies-list'`-style names in `createCache` — Task 7.

2. **Placeholder scan.** Tasks 2 step 4 and Task 6 step 6 say "search the file for X and edit each match." That's borderline placeholder — the editor needs to actually walk a file. I've left it because the matches are mechanical (rename a string, drop a line) and listing each by file:line would lock the plan to today's exact line numbers. If a subagent gets stuck, escalate as `NEEDS_CONTEXT` and the controller can inspect the file.

   Task 11 (docs) is a deliberate sweep across 8 files; no per-line edits listed because the doc rewriting was already done in PR #12 against the previous API shape and the same logic applies. The grep in step 1 is the contract.

3. **Type consistency.** `LoaderRef<T>`, `LoaderCache<T>`, `Loader<T>`, `LoaderCtx`, `ActionStub<TPayload, TResult>`, `UseActionOptions`, `DefineLoaderOpts<T>` are defined in Task 1 and used consistently across Tasks 2–12. The `invalidate` option's type `'auto' | false | ReadonlyArray<LoaderRef<unknown>>` is set in Task 3 and reused in Task 5's demo migration (the values passed conform).

4. **Build-stays-green order.**
   - Tasks 1–3 are additive: new methods/options exist alongside old paths.
   - Tasks 4–5 migrate consumers.
   - Tasks 6–8 remove the old paths once nothing depends on them.
   - Tasks 9–10 update the build-time stubs to match the new shape.
   - Task 11 (docs) lands last because it cites the final shape.
   - Task 12 verifies.

   Each task ends with a build-and-test verification. If a task breaks the build mid-flight, it's caught immediately.

5. **Risks.**
   - Task 9 step 1 changes the loader-stub generation from inlined `{ __id, fn }` to `defineLoader(fn, { __moduleKey })`. The runtime cost is one extra function call per loader import in client code; should be negligible. The risk is that `defineLoader` itself is in `@hono-preact/iso` which the client bundle already imports — no new dependency.
   - Task 6's pre-existing-errors fix in `movie.server.ts` is a small drive-by. If the LoaderCtx-typed-location change causes a knock-on (e.g., the type doesn't quite cover the existing destructure), narrow the type at the call site rather than expanding `LoaderCtx`'s shape.
   - Task 11 (docs) relies on grep coverage being complete. If a stale reference slips through, the docs build still passes; the inaccuracy is observable but not fatal. Worst case: a follow-up doc-only PR.
