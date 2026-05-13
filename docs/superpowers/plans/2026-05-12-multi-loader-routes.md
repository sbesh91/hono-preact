# Multi-Loader Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any number of loaders per `.server.*` file via an action-symmetric `serverLoaders` container; consume via a co-located `.View()` factory; auto-scope each loader to its declaring route (page or layout) so that layout-anchored loaders survive child navigation; declare per-loader search-param dependencies. Hard cutover; no compat shim.

**Architecture:** The change spans four layers: (1) the `defineLoader` runtime in `@hono-preact/iso` (LoaderRef gains `.View` and `.Boundary`, opts gain `params` and `__loaderName`); (2) the Vite plugins (`serverOnlyPlugin` allowlist swap + Proxy stub, `moduleKeyPlugin` walks into `serverLoaders` object literals); (3) the server-side RPC handler (composite `${moduleKey}::${loaderName}` dispatch); (4) the route-level location plumbing (a new `RouteLocationsContext` map keyed by moduleKey, populated by route wrappers that wrap each `.server.*`-owning route). Layout `.server.*` files are unblocked. The `<Loader>` host stops taking `location` as a prop and reads it from the context entry for its loader's moduleKey.

**Tech Stack:** TypeScript, Preact, preact-iso (routing), Vite (plugins), @babel/parser + magic-string (AST transforms), vitest + happy-dom (tests), pnpm workspace, Hono (server).

**Spec:** `docs/superpowers/specs/2026-05-12-multi-loader-routes-design.md`

---

## File Structure

### Files modified

- `packages/iso/src/define-loader.ts`; opts gain `params` + `__loaderName`; LoaderRef gains `.params`, `.__loaderName`, `.Boundary`, `.View`; `__id` symbol incorporates loaderName.
- `packages/iso/src/internal/loader.tsx`; `<Loader>` host loses `location` prop, reads from `RouteLocationsContext` via ref's moduleKey; `serializeLocation` accepts a params filter.
- `packages/iso/src/internal/contexts.ts`; add `RouteLocationsContext`.
- `packages/iso/src/internal.ts`; re-export `__$createLoaderStub_hpiso` for plugin use.
- `packages/iso/src/define-page.tsx`; drop `loader`, `fallback` from `PageBindings`; `<Page>` no longer wraps in `<Loader>`.
- `packages/iso/src/page.tsx`; corresponding signature change.
- `packages/iso/src/define-routes.tsx`; drop `hasLayout && hasServer` validation; route-component wrapping installs `RouteLocationsContext` providers; layout-group wrapper installs the layout's location.
- `packages/iso/src/index.ts`; adjust exports as needed (no API additions to the public surface beyond what flows through `LoaderRef`).
- `packages/vite/src/server-only.ts`; drop `loader`, `default` from named-import allowlist; add `serverLoaders` Proxy stub.
- `packages/vite/src/module-key-plugin.ts`; walk into `export const serverLoaders = { ... }` ObjectExpressions, inject `{ __moduleKey, __loaderName }` into each `defineLoader(arg)` call.
- `packages/server/src/loaders-handler.ts`; request body gains `loader: string`; map keyed by `${module}::${loader}`; walks `serverLoaders` named export.

### Files created

- `packages/iso/src/internal/route-locations.tsx`; `RouteLocationsContext`, `RouteLocationsProvider` helper.
- `packages/iso/src/internal/loader-stub.ts`; `__$createLoaderStub_hpiso` that builds client-side LoaderRef-shaped stubs from `{ __moduleKey, __loaderName }`.
- `packages/iso/src/__tests__/loader-view.test.tsx`; tests for `LoaderRef.View` and `.Boundary`.
- `packages/iso/src/__tests__/route-locations.test.tsx`; tests for the per-route location context.
- `packages/iso/src/__tests__/loader-params.test.ts`; tests for the `params` opt and serializeLocation filter behavior.
- `packages/vite/src/__tests__/module-key-server-loaders.test.ts`; tests for moduleKeyPlugin walking serverLoaders objects.
- `packages/vite/src/__tests__/server-only-server-loaders.test.ts`; tests for serverOnlyPlugin's serverLoaders Proxy stub.
- `packages/server/src/__tests__/loaders-handler-multi.test.ts`; tests for composite dispatch.

### Files migrated (call-site updates only, no behavior change)

- `apps/app/src/pages/movie.server.ts`, `apps/app/src/pages/movie.tsx`
- `apps/app/src/pages/movies-list.server.ts`, `apps/app/src/pages/movies-list.tsx`
- `apps/app/src/pages/watched.server.ts`, `apps/app/src/pages/watched.tsx`
- `packages/iso/src/__tests__/define-page.test.tsx`
- `packages/iso/src/__tests__/page.test.tsx`
- `packages/iso/src/__tests__/define-loader.test.ts` (new keying behavior)
- `packages/iso/src/internal/__tests__/loader.test.tsx`
- `packages/iso/src/internal/__tests__/loader-streaming.test.tsx`
- `packages/server/src/__tests__/loaders-handler.test.ts`
- `packages/server/src/__tests__/render-stream.test.tsx`
- `packages/vite/src/__tests__/server-only-plugin.test.ts`
- `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`
- `packages/vite/src/__tests__/path-key-parity.test.ts`
- `packages/vite/src/__tests__/fixtures/leak-test/pages/foo.server.ts`
- `apps/app/src/pages/docs/loaders.mdx`, `streaming.mdx`, `structure.mdx`, `quick-start.mdx`, `pages.mdx`, `reloading.mdx`

---

## Phase 1; Foundation: defineLoader opts + LoaderRef.View/Boundary

### Task 1: Add `params` opt and `__loaderName` opt to defineLoader; widen LoaderRef

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Test: `packages/iso/src/__tests__/loader-params.test.ts` (create)

- [ ] **Step 1: Write the failing tests for the new opts**

Create `packages/iso/src/__tests__/loader-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader: params opt', () => {
  it('defaults params to []', () => {
    const ref = defineLoader(async () => ({}));
    expect(ref.params).toEqual([]);
  });

  it('persists params: string[]', () => {
    const ref = defineLoader(async () => ({}), { params: ['genre', 'page'] });
    expect(ref.params).toEqual(['genre', 'page']);
  });

  it('persists params: "*"', () => {
    const ref = defineLoader(async () => ({}), { params: '*' });
    expect(ref.params).toBe('*');
  });
});

describe('defineLoader: __loaderName opt', () => {
  it('defaults __loaderName to undefined when not provided', () => {
    const ref = defineLoader(async () => ({}));
    expect(ref.__loaderName).toBeUndefined();
  });

  it('persists __loaderName from opts', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(ref.__loaderName).toBe('summary');
  });

  it('__id symbol incorporates __loaderName when both __moduleKey and __loaderName are set', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(Symbol.keyFor(ref.__id)).toBe(
      '@hono-preact/loader:pages/movie::summary'
    );
  });

  it('two loaders with same moduleKey but different loaderName have different __id', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movie', __loaderName: 'summary' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/movie', __loaderName: 'cast' });
    expect(a.__id).not.toBe(b.__id);
  });

  it('two loaders with same moduleKey but no loaderName collapse (back-compat)', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/foo' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/foo' });
    expect(a.__id).toBe(b.__id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test loader-params -- --run`
Expected: FAIL with "ref.params is undefined" / "ref.__loaderName is undefined" or symbol-key mismatches.

- [ ] **Step 3: Update `packages/iso/src/define-loader.ts`**

Apply these changes to the file:

```ts
export type DefineLoaderOpts<T> = {
  __moduleKey?: string;
  __loaderName?: string;
  cache?: LoaderCache<T>;
  params?: string[] | '*';
};

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;
  readonly params: string[] | '*';
  useData(): T;
  useError(): Error | null;
  invalidate(): void;
  // Boundary and View are added in Tasks 3 and 4; declare them here
  // so consumers see the surface, but leave their implementations for
  // those tasks.
  Boundary: import('preact').ComponentType<{
    fallback?: import('preact').ComponentChildren;
    errorFallback?:
      | import('preact').ComponentChildren
      | ((err: Error, reset: () => void) => import('preact').ComponentChildren);
    children: import('preact').ComponentChildren;
  }>;
  View<P extends Record<string, unknown> = {}>(
    render: (
      args: P & { data: T; error: Error | null; reload: () => void }
    ) => import('preact').ComponentChildren,
    opts?: {
      fallback?: import('preact').ComponentChildren;
      errorFallback?:
        | import('preact').ComponentChildren
        | ((err: Error, reset: () => void) => import('preact').ComponentChildren);
    }
  ): import('preact').FunctionComponent<P>;
}
```

In the body of `defineLoader`, replace the existing `__id` derivation:

```ts
const idKey = opts?.__moduleKey
  ? opts.__loaderName
    ? `${opts.__moduleKey}::${opts.__loaderName}`
    : opts.__moduleKey
  : null;

const __id = idKey
  ? Symbol.for(`@hono-preact/loader:${idKey}`)
  : Symbol(`@hono-preact/loader:<unkeyed>`);
```

Add `params` to the returned ref:

```ts
const ref: LoaderRef<T> = {
  __id,
  __moduleKey: opts?.__moduleKey,
  __loaderName: opts?.__loaderName,
  fn,
  cache: cache!,
  params: opts?.params ?? [],
  useData() { /* unchanged */ },
  useError() { /* unchanged */ },
  invalidate() { cache!.invalidate(); },
  // Boundary and View placeholders; implemented in Tasks 3/4. For Task 1
  // we wire stubs that throw so tests for params/__loaderName pass without
  // also requiring Boundary/View to exist yet.
  Boundary: (() => { throw new Error('Boundary not yet implemented'); }) as never,
  View: (() => { throw new Error('View not yet implemented'); }) as never,
};
```

(The Boundary/View stubs will be replaced in Tasks 3 and 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso test loader-params -- --run`
Expected: PASS.

Also run the existing define-loader tests to confirm no regression:

Run: `pnpm --filter @hono-preact/iso test define-loader -- --run`
Expected: PASS for all the keying tests already in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/loader-params.test.ts
git commit -m "feat(iso): defineLoader gains params and __loaderName opts"
```

### Task 2: serializeLocation respects per-loader params

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Test: extend `packages/iso/src/__tests__/loader-params.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/loader-params.test.ts`:

```ts
import { serializeLocationForCache } from '../internal/loader.js';

describe('serializeLocationForCache', () => {
  const loc = {
    path: '/movies/123',
    pathParams: { id: '123' },
    searchParams: { genre: 'action', utm_source: 'twitter' },
  };

  it('with params=[] returns path only (no search)', () => {
    expect(serializeLocationForCache(loc as any, [])).toBe('/movies/123?');
  });

  it('with params=["genre"] returns path plus filtered search', () => {
    expect(serializeLocationForCache(loc as any, ['genre'])).toBe(
      '/movies/123?genre=action'
    );
  });

  it('with params="*" returns path plus all sorted search', () => {
    expect(serializeLocationForCache(loc as any, '*')).toBe(
      '/movies/123?genre=action&utm_source=twitter'
    );
  });

  it('with params listing absent keys returns path plus only present', () => {
    expect(serializeLocationForCache(loc as any, ['nonexistent'])).toBe(
      '/movies/123?'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test loader-params -- --run`
Expected: FAIL; `serializeLocationForCache is not exported`.

- [ ] **Step 3: Replace existing `serializeLocation` in `packages/iso/src/internal/loader.tsx`**

Find the existing function at the bottom of `loader.tsx`:

```ts
function serializeLocation(loc: RouteHook): string {
  const sp = loc.searchParams ?? {};
  const sortedSearch = Object.keys(sp)
    .sort()
    .map((k) => `${k}=${sp[k]}`)
    .join('&');
  return `${loc.path}?${sortedSearch}`;
}
```

Replace with:

```ts
export function serializeLocationForCache(
  loc: RouteHook,
  params: string[] | '*'
): string {
  const sp = (loc.searchParams ?? {}) as Record<string, string>;
  const keys =
    params === '*'
      ? Object.keys(sp).sort()
      : params.filter((k) => k in sp).sort();
  const sortedSearch = keys.map((k) => `${k}=${sp[k]}`).join('&');
  return `${loc.path}?${sortedSearch}`;
}
```

Update the two call sites inside `LoaderHost` that previously called `serializeLocation(location)` to call `serializeLocationForCache(location, loaderRef.params)`. Search for `serializeLocation(` in the file; there are two (the `locKey` derivation around line 168, and the cache.set call around line 132). Also delete the old function definition.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso test loader-params -- --run`
Expected: PASS.

Run all iso tests to confirm no regression:

Run: `pnpm --filter @hono-preact/iso test -- --run`
Expected: PASS (existing tests use the default `params: []`, so paths now lack search; the existing tests assert against location keys that include only `path` after this change. If anything fails because a test asserted on the full search-bag key, update those tests in this commit.)

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/__tests__/loader-params.test.ts
git commit -m "feat(iso): per-loader params filter in cache key"
```

### Task 3: LoaderRef.Boundary component

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/internal/loader.tsx` (export the existing `<Loader>` host as a public-facing wrapper)
- Test: `packages/iso/src/__tests__/loader-view.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/loader-view.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { Suspense } from 'preact/compat';
import { render, waitFor } from '@testing-library/preact';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';

describe('LoaderRef.Boundary', () => {
  it('renders the loader fallback then transitions to children with data', async () => {
    let resolveData: (v: { value: number }) => void = () => {};
    const ref = defineLoader<{ value: number }>(
      () => new Promise((res) => { resolveData = res; })
    );

    const Probe = () => {
      const data = ref.useData();
      return <span data-testid="data">{data.value}</span>;
    };

    const locMap = new Map();
    const tree = (
      <RouteLocationsContext.Provider value={locMap}>
        <ref.Boundary fallback={<span data-testid="fallback">loading</span>}>
          <Probe />
        </ref.Boundary>
      </RouteLocationsContext.Provider>
    );

    const { findByTestId, queryByTestId } = render(tree);
    expect(queryByTestId('fallback')).not.toBeNull();
    resolveData({ value: 42 });
    const el = await findByTestId('data');
    expect(el.textContent).toBe('42');
  });
});
```

(This test uses the `RouteLocationsContext` we'll create in Task 9; for Task 3 we accept the test pre-references it. If RouteLocationsContext isn't created yet, the import will fail. Either land Task 9 first OR stub the context here. We choose to land Task 9 BEFORE Task 3 in the actual execution order; see the Phase ordering note at the bottom. For Task 3, write the test as shown; if you're executing strictly sequentially, do Task 9 first then come back here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test loader-view -- --run`
Expected: FAIL; `ref.Boundary` throws "not yet implemented" (from Task 1's stub).

- [ ] **Step 3: Replace `Boundary` stub in `packages/iso/src/define-loader.ts`**

Wire `Boundary` to the existing `<Loader>` host (which already owns Suspense + error context + data context + reload context):

In `defineLoader.ts`, import the host:

```ts
import { Loader as LoaderHost } from './internal/loader.js';
```

(The host currently takes `loader`, `location`, `fallback`, `children`. After Task 11 it stops taking `location`. For now the host still takes location; we'll have the Boundary read it from RouteLocationsContext.)

Implement `Boundary` on the ref:

```ts
const Boundary: LoaderRef<T>['Boundary'] = ({ fallback, errorFallback, children }) => {
  return h(LoaderHost as any, {
    loader: ref,
    fallback,
    errorFallback,
    children,
  });
};
ref.Boundary = Boundary;
```

(Use `h` from preact and a local `as any` cast to bridge until LoaderHost's type is updated in Task 11. We replace this fully in Task 11.)

For now, also make LoaderHost tolerate a missing `location` prop by reading from context. Add at the top of `LoaderHost`:

```ts
import { useContext } from 'preact/hooks';
import { RouteLocationsContext } from './route-locations.js';

// inside LoaderHost, before using `location`:
const locMap = useContext(RouteLocationsContext);
const ctxLocation = loaderRef.__moduleKey ? locMap?.get(loaderRef.__moduleKey) : undefined;
const location = (props.location ?? ctxLocation) as RouteHook | undefined;
if (!location) {
  throw new Error(
    `Loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
    `wrap the page in a route that owns this server module, or pass location explicitly.`
  );
}
```

(This makes `location` a derived value; LoaderHost's prop type changes to `location?: RouteHook` in this task. Task 11 finishes the cleanup.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/iso test loader-view -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/internal/loader.tsx packages/iso/src/__tests__/loader-view.test.tsx
git commit -m "feat(iso): LoaderRef.Boundary component"
```

### Task 4: LoaderRef.View factory

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Test: extend `packages/iso/src/__tests__/loader-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/loader-view.test.tsx`:

```tsx
import type { FunctionComponent } from 'preact';

describe('LoaderRef.View', () => {
  it('renders fallback then provides data, error, reload to render fn', async () => {
    let resolveData: (v: { name: string }) => void = () => {};
    const ref = defineLoader<{ name: string }>(
      () => new Promise((res) => { resolveData = res; })
    );

    const View = ref.View(
      ({ data }) => <span data-testid="name">{data.name}</span>,
      { fallback: <span data-testid="fallback">…</span> }
    );

    const locMap = new Map();
    const { queryByTestId, findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View />
      </RouteLocationsContext.Provider>
    );
    expect(queryByTestId('fallback')).not.toBeNull();
    resolveData({ name: 'ada' });
    const el = await findByTestId('name');
    expect(el.textContent).toBe('ada');
  });

  it('forwards arbitrary props to the render function', async () => {
    const ref = defineLoader<{ value: number }>(async () => ({ value: 1 }));
    const View: FunctionComponent<{ label: string }> = ref.View<{ label: string }>(
      ({ data, label }) => (
        <span data-testid="composed">{label}:{data.value}</span>
      ),
      { fallback: <span /> }
    );
    const locMap = new Map();
    const { findByTestId } = render(
      <RouteLocationsContext.Provider value={locMap}>
        <View label="movie" />
      </RouteLocationsContext.Provider>
    );
    const el = await findByTestId('composed');
    expect(el.textContent).toBe('movie:1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test loader-view -- --run`
Expected: FAIL; `ref.View` throws "not yet implemented".

- [ ] **Step 3: Implement `.View` on the ref**

In `packages/iso/src/define-loader.ts`, add (replacing the View stub):

```ts
import { useContext } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';

const View: LoaderRef<T>['View'] = (render, viewOpts) => {
  const Wrapped: import('preact').FunctionComponent<any> = (props) =>
    h(ref.Boundary, {
      fallback: viewOpts?.fallback,
      errorFallback: viewOpts?.errorFallback,
      children: h(ViewRenderer<T> as any, { ref, props, render }),
    });
  return Wrapped;
};
ref.View = View;
```

Add a small `ViewRenderer` helper at module scope:

```ts
function ViewRenderer<T>({
  ref,
  props,
  render,
}: {
  ref: LoaderRef<T>;
  props: Record<string, unknown>;
  render: (args: any) => import('preact').ComponentChildren;
}) {
  const data = ref.useData();
  const error = ref.useError();
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, error, reload, ...props }) as any;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso test loader-view -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/loader-view.test.tsx
git commit -m "feat(iso): LoaderRef.View factory"
```

---

## Phase 2; Per-route location context

### Task 5: Create RouteLocationsContext + provider

**Files:**
- Create: `packages/iso/src/internal/route-locations.tsx`
- Create: `packages/iso/src/__tests__/route-locations.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/route-locations.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render } from '@testing-library/preact';
import {
  RouteLocationsContext,
  RouteLocationsProvider,
} from '../internal/route-locations.js';

describe('RouteLocationsProvider', () => {
  it('exposes the moduleKey -> location map to descendants', () => {
    const inner = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} };
    let observed: any = null;

    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    render(
      h(
        RouteLocationsProvider,
        { moduleKey: 'pages/movie', location: inner as any },
        h(Probe, null)
      )
    );

    expect(observed).toBeInstanceOf(Map);
    expect(observed.get('pages/movie')).toEqual(inner);
  });

  it('extends a parent map without mutating it', () => {
    const outer = { path: '/movies', pathParams: {}, searchParams: {} };
    const inner = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} };
    let observed: any = null;

    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    render(
      h(
        RouteLocationsProvider,
        { moduleKey: 'pages/movies-layout', location: outer as any },
        h(
          RouteLocationsProvider,
          { moduleKey: 'pages/movie', location: inner as any },
          h(Probe, null)
        )
      )
    );

    expect(observed.get('pages/movies-layout')).toEqual(outer);
    expect(observed.get('pages/movie')).toEqual(inner);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/iso test route-locations -- --run`
Expected: FAIL; module not found.

- [ ] **Step 3: Implement `packages/iso/src/internal/route-locations.tsx`**

```tsx
import { createContext, h } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';

export const RouteLocationsContext = createContext<ReadonlyMap<string, RouteHook>>(
  new Map()
);

export function RouteLocationsProvider({
  moduleKey,
  location,
  children,
}: {
  moduleKey: string | undefined;
  location: RouteHook;
  children: ComponentChildren;
}) {
  const parent = useContext(RouteLocationsContext);
  const next = useMemo(() => {
    if (!moduleKey) return parent;
    const m = new Map(parent);
    m.set(moduleKey, location);
    return m;
  }, [parent, moduleKey, location]);
  return h(RouteLocationsContext.Provider, { value: next }, children);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/iso test route-locations -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/route-locations.tsx packages/iso/src/__tests__/route-locations.test.tsx
git commit -m "feat(iso): RouteLocationsContext + provider"
```

### Task 6: defineRoutes wraps each `.server.*`-owning route in a RouteLocationsProvider

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Test: `packages/iso/src/__tests__/define-routes-server.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/define-routes-server.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { RouteLocationsContext } from '../internal/route-locations.js';

describe('defineRoutes: per-route location plumbing', () => {
  it('installs RouteLocationsProvider for a page-level server module', async () => {
    let observed: any = null;
    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    const manifest = defineRoutes([
      {
        path: '/foo/:id',
        view: () => Promise.resolve({ default: Probe }),
        server: () => Promise.resolve({ __moduleKey: 'pages/foo' }),
      },
    ]);

    render(
      h(LocationProvider, { url: '/foo/123' }, h(Routes, { routes: manifest }))
    );

    await waitFor(() => expect(observed).toBeInstanceOf(Map));
    const loc = observed.get('pages/foo');
    expect(loc).toBeDefined();
    expect(loc.path).toBe('/foo/123');
    expect(loc.pathParams).toEqual({ id: '123' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test define-routes-server -- --run`
Expected: FAIL; `observed` is the empty default Map; nothing is plumbed yet.

- [ ] **Step 3: Update `defineRoutes` and view-component construction**

In `packages/iso/src/define-routes.tsx`:

a) Extend `RouteDef` to expose its server module's key after load:

The existing `LazyServerImport` is `() => Promise<unknown>`. We need the moduleKey at runtime. The plugin already injects `__moduleKey` into the server module (see `moduleKeyPlugin`), so `(await server()).__moduleKey` is the key.

b) Modify `getOrCreateLazyView` to optionally wrap the loaded view component in a `RouteLocationsProvider` when the route has a `server` import:

Add a second parameter to capture the server thunk. Replace the current helper:

```tsx
function getOrCreateLazyView(
  view: NonNullable<RouteDef['view']>,
  server: RouteDef['server'] | undefined,
  cache: Map<unknown, ComponentType<ViewProps>>
): ComponentType<ViewProps> {
  let component = cache.get(view);
  if (!component) {
    if (!server) {
      component = asViewComponent(lazy(view));
    } else {
      component = asViewComponent(
        lazy(async () => {
          const [{ default: View }, serverMod] = await Promise.all([
            view(),
            server(),
          ]);
          const moduleKey = (serverMod as { __moduleKey?: string }).__moduleKey;
          const Wrapped: ComponentType<ViewProps> = (location) =>
            h(
              RouteLocationsProvider,
              { moduleKey, location },
              h(View as ComponentType<ViewProps>, location)
            );
          return { default: Wrapped };
        })
      );
    }
    cache.set(view, component);
  }
  return component;
}
```

c) Update both call sites in `flattenTree` and `buildInnerRoutes` to thread `r.server` through.

d) Add the import at the top:

```tsx
import { RouteLocationsProvider } from './internal/route-locations.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/iso test define-routes-server -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes-server.test.tsx
git commit -m "feat(iso): defineRoutes wraps page-level server routes with RouteLocationsProvider"
```

### Task 7: Layout-level RouteLocationsProvider; remove `hasLayout && hasServer` rejection

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`
- Test: extend `packages/iso/src/__tests__/define-routes-server.test.tsx`

- [ ] **Step 1: Write the failing test**

Append:

```tsx
import { Router } from 'preact-iso';

describe('defineRoutes: layout-level server plumbing', () => {
  it('allows a layout to declare server and installs a stable layout location', async () => {
    let observed: any = null;
    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    // Layout component that renders the inner Router output as <main>.
    const Layout = ({ children }: { children: any }) => h('main', null, children);

    const manifest = defineRoutes([
      {
        path: '/movies',
        layout: () => Promise.resolve({ default: Layout as any }),
        server: () => Promise.resolve({ __moduleKey: 'pages/movies-layout' }),
        children: [
          {
            path: ':id',
            view: () => Promise.resolve({ default: Probe }),
            server: () => Promise.resolve({ __moduleKey: 'pages/movie' }),
          },
        ],
      },
    ]);

    render(
      h(LocationProvider, { url: '/movies/123' }, h(Routes, { routes: manifest }))
    );

    await waitFor(() => expect(observed?.get('pages/movie')).toBeDefined());
    const layoutLoc = observed.get('pages/movies-layout');
    const pageLoc = observed.get('pages/movie');
    expect(layoutLoc).toBeDefined();
    expect(layoutLoc.path).toBe('/movies');
    expect(pageLoc.path).toBe('/movies/123');
    expect(pageLoc.pathParams).toEqual({ id: '123' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test define-routes-server -- --run`
Expected: FAIL; currently `defineRoutes` throws `layout cannot declare server` from `validate()`.

- [ ] **Step 3: Update `defineRoutes`**

a) In `validate()`, delete the rejection block:

```diff
-    if (hasLayout && hasServer) {
-      throw new Error(`Route ${here}: \`layout\` cannot declare \`server\` (one loader per leaf).`);
-    }
```

b) In `makeLayoutGroupComponent`, install a `RouteLocationsProvider` for the layout's matched location. The layout's matched location is computed from the wildcard route's RouteHook by:
- `path`: the layout's path with pathParams substituted (the layout's own path pattern, NOT including the wildcard rest).
- `pathParams`: all named pathParams except the wildcard's `0`/`rest` key.
- `searchParams`: passed through as-is.

Replace `makeLayoutGroupComponent` with:

```tsx
function makeLayoutGroupComponent(
  layoutImport: NonNullable<RouteDef['layout']>,
  server: RouteDef['server'] | undefined,
  layoutPathPattern: string,
  children: ReadonlyArray<RouteDef>,
  viewCache: Map<unknown, ComponentType<ViewProps>>
): ComponentType<ViewProps> {
  return asViewComponent(
    lazy(async () => {
      const [{ default: Layout }, serverMod] = await Promise.all([
        layoutImport(),
        server ? server() : Promise.resolve(undefined),
      ]);
      const moduleKey = (serverMod as { __moduleKey?: string } | undefined)?.__moduleKey;
      const inner = buildInnerRoutes(children, viewCache);
      const Wrapper: ComponentType<ViewProps> = (location) => {
        const layoutLocation = deriveLayoutLocation(location, layoutPathPattern);
        const layoutNode = h(Layout, null, h(Router, null, ...inner));
        return moduleKey
          ? h(RouteLocationsProvider, { moduleKey, location: layoutLocation }, layoutNode)
          : layoutNode;
      };
      return { default: Wrapper };
    })
  );
}

function deriveLayoutLocation(active: ViewProps, layoutPathPattern: string): ViewProps {
  // Substitute named pathParams (excluding the wildcard rest) into the
  // layout's pattern. The wildcard is conventionally exposed by preact-iso
  // as the `rest` key on pathParams.
  const params = active.pathParams ?? {};
  const path = layoutPathPattern
    .split('/')
    .map((seg) =>
      seg.startsWith(':')
        ? String(params[seg.slice(1)] ?? '')
        : seg.startsWith('*')
          ? ''
          : seg
    )
    .filter(Boolean)
    .join('/');
  const finalPath = '/' + path;
  const filteredParams: Record<string, string> = {};
  for (const k of Object.keys(params)) {
    if (k !== 'rest' && k !== '0') filteredParams[k] = params[k] as string;
  }
  return {
    ...active,
    path: finalPath === '/' ? '/' : finalPath,
    pathParams: filteredParams,
  };
}
```

c) Update both call sites of `makeLayoutGroupComponent` in `flattenTree` and `buildInnerRoutes` to pass `r.server` and the layout's path pattern (`here` in `flattenTree`; `child.path` in `buildInnerRoutes` joined with parent prefix).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/iso test define-routes-server -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes-server.test.tsx
git commit -m "feat(iso): unblock layout server modules + install layout location"
```

### Task 8: `<Loader>` host reads location from RouteLocationsContext

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx`
- Test: extend `packages/iso/src/__tests__/loader-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `loader-view.test.tsx`:

```tsx
import { LocationProvider } from 'preact-iso';
import { RouteLocationsProvider } from '../internal/route-locations.js';

describe('LoaderRef.Boundary: reads location from RouteLocationsContext', () => {
  it('uses the location for its own moduleKey', async () => {
    const seen: { path: string }[] = [];
    const ref = defineLoader<{ path: string }>(
      async ({ location }) => {
        seen.push({ path: location.path });
        return { path: location.path };
      },
      { __moduleKey: 'pages/test' }
    );

    const Probe = () => {
      const data = ref.useData();
      return <span data-testid="path">{data.path}</span>;
    };

    const layoutLoc = { path: '/movies', pathParams: {}, searchParams: {} } as any;
    const pageLoc = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} } as any;

    const { findByTestId } = render(
      <LocationProvider url="/movies/123">
        <RouteLocationsProvider moduleKey="pages/movies-layout" location={layoutLoc}>
          <RouteLocationsProvider moduleKey="pages/test" location={pageLoc}>
            <ref.Boundary fallback={<span />}>
              <Probe />
            </ref.Boundary>
          </RouteLocationsProvider>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    const el = await findByTestId('path');
    expect(el.textContent).toBe('/movies/123');
    expect(seen[0]).toEqual({ path: '/movies/123' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test loader-view -- --run`
Expected: This may already pass after Task 3 (which already added the context-fallback path). If so, mark this task as a confirmation step rather than a failing-test moment. If FAIL, fix in Step 3.

- [ ] **Step 3: Confirm or finalize the LoaderHost change from Task 3**

Make sure `LoaderHost`'s `LoaderProps<T>` no longer requires `location`. The component should only fall back to context when `location` prop is absent; but in this design the prop is no longer passed by Boundary, so we can fully remove it:

```ts
type LoaderProps<T> = {
  loader: LoaderRef<T>;
  fallback?: JSX.Element;
  errorFallback?: JSX.Element | ((err: Error, reset: () => void) => JSX.Element);
  children: ComponentChildren;
};
```

Inside `LoaderHost`, replace the `location` prop usage with the context lookup (already added in Task 3); now just delete the `props.location ?? ctxLocation` fallback in favor of context-only:

```ts
const locMap = useContext(RouteLocationsContext);
const location = loaderRef.__moduleKey ? locMap.get(loaderRef.__moduleKey) : undefined;
if (!location) {
  throw new Error(
    `Loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' has no location: ` +
    `the route owning this server module must be present in the route tree.`
  );
}
```

If any test fixture or existing `<Loader>` consumer passes `location` directly (the movies-demo workaround does), it must be migrated in Phase 4. For now, deleting the prop is the breaking signal.

- [ ] **Step 4: Run all iso tests**

Run: `pnpm --filter @hono-preact/iso test -- --run`
Expected: PASS for the ones we wrote; some existing tests may fail because they passed `location` directly. Note their failures and migrate in Task 18.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/__tests__/loader-view.test.tsx
git commit -m "feat(iso): Loader host reads location from RouteLocationsContext"
```

---

## Phase 3; `serverLoaders` container: wire format + plugins

### Task 9: loaders-handler accepts `loader` field; dispatches by composite key; walks `serverLoaders`

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Test: `packages/server/src/__tests__/loaders-handler-multi.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/loaders-handler-multi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';

describe('loadersHandler: serverLoaders dispatch', () => {
  const fakeModule = {
    __moduleKey: 'pages/movie',
    serverLoaders: {
      summary: async ({ location }: any) => ({ kind: 'summary', id: location.pathParams.id }),
      cast: async ({ location }: any) => ({ kind: 'cast', id: location.pathParams.id }),
    },
  };

  const glob = { './pages/movie.server.ts': fakeModule };

  it('dispatches to summary by composite key', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'summary',
        location: { path: '/movies/9', pathParams: { id: '9' }, searchParams: {} },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ kind: 'summary', id: '9' });
  });

  it('dispatches to cast by composite key', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'cast',
        location: { path: '/movies/9', pathParams: { id: '9' }, searchParams: {} },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ kind: 'cast', id: '9' });
  });

  it('returns 404 for unknown loader name', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        loader: 'nonexistent',
        location: { path: '/movies/9', pathParams: { id: '9' }, searchParams: {} },
      }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when loader field is missing', async () => {
    const app = new Hono();
    app.post('/__loaders', loadersHandler(glob as any));

    const res = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'pages/movie',
        location: { path: '/movies/9', pathParams: { id: '9' }, searchParams: {} },
      }),
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/server test loaders-handler-multi -- --run`
Expected: FAIL; current handler dispatches by `module` only and accepts/ignores `loader` field.

- [ ] **Step 3: Update `packages/server/src/loaders-handler.ts`**

Replace `buildLoadersMap`:

```ts
async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const moduleKey = mod.__moduleKey;
    if (typeof moduleKey !== 'string') continue;

    const sl = (mod as any).serverLoaders;
    if (sl && typeof sl === 'object') {
      for (const [name, fn] of Object.entries(sl)) {
        if (typeof fn === 'function') {
          result[`${moduleKey}::${name}`] = fn as LoaderFn;
        }
      }
    }
  }
  return result;
}
```

Add `loader: string` validation and composite dispatch in the request handler:

```ts
const { module, loader: loaderName, location } = body as {
  module: unknown;
  loader: unknown;
  location: unknown;
};
if (typeof module !== 'string') {
  return c.json({ error: 'Request body must include string field: module' }, 400);
}
if (typeof loaderName !== 'string') {
  return c.json({ error: 'Request body must include string field: loader' }, 400);
}
const validatedLocation = validateLocation(location);
if (!validatedLocation) {
  return c.json(
    {
      error:
        'Request body must include object field: location with shape { path: string, pathParams: object, searchParams: object }',
    },
    400
  );
}
const loaderFn = loadersMap[`${module}::${loaderName}`];
if (!loaderFn) {
  return c.json({ error: `Loader '${module}::${loaderName}' not found` }, 404);
}
```

Also update the body type alias at the top of the request callback to include `loader: unknown`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/server test loaders-handler-multi -- --run`
Expected: PASS.

The existing `loaders-handler.test.ts` will FAIL because it tests the old wire format. We migrate it in Task 18.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler-multi.test.ts
git commit -m "feat(server): loaders-handler dispatches by composite serverLoaders key"
```

### Task 10: Extend moduleKeyPlugin to walk into `serverLoaders` ObjectExpression

**Files:**
- Modify: `packages/vite/src/module-key-plugin.ts`
- Test: `packages/vite/src/__tests__/module-key-server-loaders.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/module-key-server-loaders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

function transform(code: string, id: string, root = '/Users/me/repo'): string | undefined {
  const plugin = moduleKeyPlugin() as Plugin & {
    transform: any;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root });
  const r = plugin.transform.call({} as any, code, id);
  return typeof r === 'object' ? r.code : r;
}

describe('moduleKeyPlugin: serverLoaders walking', () => {
  it('injects __moduleKey + __loaderName into each defineLoader call inside serverLoaders', () => {
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const serverLoaders = {
        summary: defineLoader(async () => ({})),
        cast: defineLoader(async function* () { yield {}; }),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/movie.server.ts');
    expect(out).toContain('__moduleKey: "src/pages/movie", __loaderName: "summary"');
    expect(out).toContain('__moduleKey: "src/pages/movie", __loaderName: "cast"');
  });

  it('still injects __moduleKey for top-level export const loader = defineLoader(...)', () => {
    // Backwards behavior is preserved during the transition; once migration
    // is complete, top-level `loader` exports won't exist anymore.
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const loader = defineLoader(async () => ({}));
    `;
    const out = transform(code, '/Users/me/repo/src/pages/foo.server.ts');
    expect(out).toContain('__moduleKey: "src/pages/foo"');
  });

  it('does not inject opts when defineLoader already has a second arg', () => {
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const serverLoaders = {
        x: defineLoader(async () => ({}), { params: ['q'] }),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/foo.server.ts') ?? '';
    // The plugin should NOT add a third arg or break the existing call.
    // Two acceptable behaviors: (a) skip rewriting (b) merge into the
    // existing opts. We choose (b): merge by inserting __moduleKey/__loaderName
    // into the existing object literal.
    expect(out).toContain('__moduleKey: "src/pages/foo"');
    expect(out).toContain('__loaderName: "x"');
    expect(out).toContain("params: ['q']");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/vite test module-key-server-loaders -- --run`
Expected: FAIL; current plugin only walks top-level CallExpressions.

- [ ] **Step 3: Update `packages/vite/src/module-key-plugin.ts`**

Add an ObjectExpression walk for `serverLoaders` declarations. Inside the existing top-level statement loop, add a branch:

```ts
import type { ObjectProperty, ObjectExpression, CallExpression } from '@babel/types';

// helper: rewrite a defineLoader call to include __moduleKey + optional __loaderName.
const visitCallWithName = (node: CallExpression, loaderName: string | undefined) => {
  if (
    node.callee.type !== 'Identifier' ||
    node.callee.name !== 'defineLoader'
  ) {
    return;
  }
  if (node.arguments.length === 0 || node.arguments.length > 2) return;
  const fnArg = node.arguments[0];
  if (fnArg.type === 'StringLiteral') return;

  if (node.arguments.length === 1) {
    const insertAt = fnArg.end;
    if (insertAt == null) return;
    const namePart = loaderName ? `, __loaderName: ${JSON.stringify(loaderName)}` : '';
    s.appendRight(
      insertAt,
      `, { __moduleKey: ${JSON.stringify(key)}${namePart} }`
    );
    return;
  }

  // arguments.length === 2: existing opts object; merge fields.
  const optsArg = node.arguments[1];
  if (optsArg.type !== 'ObjectExpression') return; // unsupported shape; bail
  const insertAt = (optsArg.properties[0]?.start ?? (optsArg.start! + 1));
  const namePart = loaderName ? `__loaderName: ${JSON.stringify(loaderName)}, ` : '';
  s.appendRight(
    insertAt,
    `__moduleKey: ${JSON.stringify(key)}, ${namePart}`
  );
};
```

In the top-level walk, replace the existing `visitCall` invocation site to call `visitCallWithName(node, undefined)` for top-level direct `export const loader = defineLoader(...)` style. Then add a new branch for `serverLoaders` declarations:

```ts
const visitObjectAsServerLoaders = (obj: ObjectExpression) => {
  for (const prop of obj.properties) {
    if (
      prop.type !== 'ObjectProperty' ||
      prop.key.type !== 'Identifier' ||
      prop.value.type !== 'CallExpression'
    ) continue;
    visitCallWithName(prop.value, prop.key.name);
  }
};

for (const stmt of ast.program.body) {
  if (
    stmt.type === 'ExportNamedDeclaration' &&
    stmt.declaration?.type === 'VariableDeclaration'
  ) {
    for (const decl of stmt.declaration.declarations) {
      if (
        decl.id.type === 'Identifier' &&
        decl.id.name === 'serverLoaders' &&
        decl.init?.type === 'ObjectExpression'
      ) {
        visitObjectAsServerLoaders(decl.init);
      } else if (decl.init?.type === 'CallExpression') {
        visitCallWithName(decl.init, undefined);
      }
    }
  }
}
```

(Delete the old `VariableDeclaration` branch that walked any `decl.init?.type === 'CallExpression'` at the file root, since `serverLoaders` is now the canonical container; legacy top-level `defineLoader` calls outside `export const` are not supported anyway.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/vite test module-key-server-loaders -- --run`
Expected: PASS.

Run existing module-key tests to verify no regression:

Run: `pnpm --filter @hono-preact/vite test module-key -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/module-key-plugin.ts packages/vite/src/__tests__/module-key-server-loaders.test.ts
git commit -m "feat(vite): moduleKeyPlugin walks serverLoaders objects"
```

### Task 11: Create `__$createLoaderStub_hpiso` in @hono-preact/iso/internal

**Files:**
- Create: `packages/iso/src/internal/loader-stub.ts`
- Modify: `packages/iso/src/internal.ts` (re-export the stub)

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/internal/__tests__/loader-stub.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { __$createLoaderStub_hpiso } from '../loader-stub.js';

describe('__$createLoaderStub_hpiso', () => {
  it('returns a LoaderRef-shaped object', () => {
    const stub = __$createLoaderStub_hpiso({
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(stub.__moduleKey).toBe('pages/movie');
    expect(stub.__loaderName).toBe('summary');
    expect(typeof stub.__id).toBe('symbol');
    expect(Symbol.keyFor(stub.__id)).toBe('@hono-preact/loader:pages/movie::summary');
    expect(typeof stub.fn).toBe('function');
    expect(typeof stub.useData).toBe('function');
    expect(typeof stub.useError).toBe('function');
    expect(typeof stub.invalidate).toBe('function');
    expect(typeof stub.View).toBe('function');
    expect(stub.Boundary).toBeDefined();
    expect(stub.params).toEqual([]);
  });

  it('two stubs with the same key share __id (and thus cache)', () => {
    const a = __$createLoaderStub_hpiso({ __moduleKey: 'pages/x', __loaderName: 'foo' });
    const b = __$createLoaderStub_hpiso({ __moduleKey: 'pages/x', __loaderName: 'foo' });
    expect(a.__id).toBe(b.__id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test loader-stub -- --run`
Expected: FAIL; module not found.

- [ ] **Step 3: Implement `packages/iso/src/internal/loader-stub.ts`**

```ts
import { defineLoader, type LoaderRef } from '../define-loader.js';

type StubOpts = {
  __moduleKey: string;
  __loaderName: string;
  params?: string[] | '*';
};

export function __$createLoaderStub_hpiso<T = unknown>(
  opts: StubOpts
): LoaderRef<T> {
  // The stub's fn is a fetch arrow that invokes the RPC. The
  // serverOnlyPlugin, when stubbing serverLoaders on the client, will set
  // the fn to its own loaderFetchArrow; this default is a safety net for
  // stubs constructed at runtime (vanishingly rare path).
  const fn = async () => {
    throw new Error(
      `Loader stub for '${opts.__moduleKey}::${opts.__loaderName}' invoked directly; ` +
      `expected the server-only plugin to replace the fn at build time.`
    );
  };
  // defineLoader does the cache + symbol + useData/useError plumbing.
  return defineLoader<T>(fn as any, {
    __moduleKey: opts.__moduleKey,
    __loaderName: opts.__loaderName,
    params: opts.params,
  });
}
```

In `packages/iso/src/internal.ts`, re-export the stub so the plugin can `import { __$createLoaderStub_hpiso } from '@hono-preact/iso/internal';`; but check the existing `internal.ts` first to confirm the export shape, then add:

```ts
export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hono-preact/iso test loader-stub -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/loader-stub.ts packages/iso/src/internal/__tests__/loader-stub.test.ts packages/iso/src/internal.ts
git commit -m "feat(iso): __$createLoaderStub_hpiso for plugin-emitted client stubs"
```

### Task 12: serverOnlyPlugin allowlist swap + serverLoaders Proxy stub

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Test: `packages/vite/src/__tests__/server-only-server-loaders.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/server-only-server-loaders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../server-only.js';
import type { Plugin } from 'vite';

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & {
    transform: any;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root: options.root ?? '/Users/me/repo' });
  return plugin.transform.call({} as any, code, id, options.ssr ? { ssr: options.ssr } : {});
}

describe('serverOnlyPlugin: serverLoaders Proxy stub', () => {
  it('replaces a serverLoaders named import with a Proxy keyed by moduleKey', () => {
    const code = `import { serverLoaders } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`__$createLoaderStub_hpiso`);
    expect(result?.code).toContain(`new Proxy`);
    expect(result?.code).toContain(`"src/pages/movies"`);
  });

  it('uses the local-name binding when serverLoaders is renamed', () => {
    const code = `import { serverLoaders as movieLoaders } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`const movieLoaders`);
    expect(result?.code).toContain(`new Proxy`);
  });

  it('rejects an unknown named import from a *.server.* file with a helpful message', () => {
    const code = `import { somethingElse } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });

  it('no longer accepts the legacy `loader` named import', () => {
    const code = `import { loader } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });

  it('no longer accepts a default import from a *.server.* file', () => {
    const code = `import serverLoader from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hono-preact/vite test server-only-server-loaders -- --run`
Expected: FAIL on all 5 (current plugin treats default import and `loader` as valid; doesn't know about `serverLoaders`).

- [ ] **Step 3: Update `packages/vite/src/server-only.ts`**

a) Drop the default-import branch (around the `isDefaultImport` block).

b) In the named-import branch, replace the `loader` recognition with `serverLoaders`. Add the case before the existing `serverActions` branch:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'serverLoaders'
) {
  needsCreateLoaderStubImport = true;
  stubs.push(
    `const ${specifier.local.name} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    return __$createLoaderStub_hpiso({\n` +
    `      __moduleKey: ${JSON.stringify(moduleKey)},\n` +
    `      __loaderName: String(name),\n` +
    `    });\n` +
    `  }\n` +
    `});`
  );
}
```

c) Remove the entire `loader` branch.

d) Update the catch-all error message:

```ts
throw new Error(
  `${id}: \`${importedName}\` is not a recognized export from a *.server.* module. ` +
  `Allowed: serverLoaders, serverGuards, serverActions, actionGuards.`
);
```

e) Remove the default-import handling. The default-export RPC stub goes away; `serverLoaders.default` is the new way.

f) Add the `__$createLoaderStub_hpiso` import emission, alongside the existing `defineLoader`/`useAction` ones:

```ts
let needsCreateLoaderStubImport = false;
// ... at the bottom, after the loop:
if (needsCreateLoaderStubImport) {
  s.prepend(`import { __$createLoaderStub_hpiso } from '@hono-preact/iso/internal';\n`);
}
```

g) Stop emitting the `defineLoader` import path entirely (the `loader` named-import branch was the only consumer; with that removed, `needsDefineLoaderImport` is dead code). Delete it.

h) The Proxy stub creates a fresh `LoaderRef` on every property access. Since `defineLoader`'s shared-cache map dedupes by `__id` (`Symbol.for(...)`), repeated stubs share their cache. The stub's `.fn` is the RPC fetch arrow; the actual wiring of that arrow happens in Task 13 (which refactors `fetchLoaderData` and updates `loader-stub.ts` to call it with separate `(moduleKey, loaderName)` args). For Task 12, leave `loader-stub.ts`'s placeholder `fn` from Task 11 in place; Task 13 replaces it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @hono-preact/vite test server-only-server-loaders -- --run`
Expected: PASS.

Run all server-only tests to confirm regression of legacy paths is intentional:

Run: `pnpm --filter @hono-preact/vite test server-only -- --run`
Expected: Some legacy tests in `server-only-plugin.test.ts` will FAIL (default import, `loader` named import). They will be migrated/replaced in Task 19.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-only.ts packages/iso/src/internal/loader-stub.ts packages/iso/src/internal/loader-fetch.ts packages/vite/src/__tests__/server-only-server-loaders.test.ts
git commit -m "feat(vite): serverLoaders Proxy stub; drop legacy default + loader allowlist entries"
```

### Task 13: Refactor `fetchLoaderData` to take `loaderName` as a separate arg

**Files:**
- Modify: `packages/iso/src/internal/loader-fetch.ts`
- Modify: `packages/iso/src/internal/loader.tsx` (two call sites)
- Modify: `packages/iso/src/internal/loader-stub.ts` (the stub's fn)

- [ ] **Step 1: Write a failing test**

Create `packages/iso/src/internal/__tests__/loader-fetch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';

describe('fetchLoaderData: separate module + loader args', () => {
  it('puts both module and loader into the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchLoaderData(
      'pages/movie',
      'summary',
      { path: '/movies/1', pathParams: { id: '1' }, searchParams: {} },
      new AbortController().signal,
      { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.module).toBe('pages/movie');
    expect(body.loader).toBe('summary');

    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hono-preact/iso test loader-fetch -- --run`
Expected: FAIL; current `fetchLoaderData` takes only one identifier arg.

- [ ] **Step 3: Update `fetchLoaderData` signature**

In `loader-fetch.ts`, change the signature:

```ts
export async function fetchLoaderData<T>(
  moduleKey: string,
  loaderName: string,
  location: SerializedLocation,
  signal: AbortSignal,
  callbacks: { onChunk: (v: T) => void; onError: (e: Error) => void; onEnd: () => void }
): Promise<T> {
  // ... existing body, with the request payload changed to:
  body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
  // ... and the SSR streaming SSE path uses the same composite identifier in
  //     any place it currently uses `moduleKey` for routing.
}
```

- [ ] **Step 4: Update LoaderHost call sites in `loader.tsx`**

Find the two `fetchLoaderData(loaderRef.__moduleKey!, { path: ..., ... }, ...)` calls (one in `runReload`, one in the first-render branch). Update each to pass loader name:

```ts
const loaderName = loaderRef.__loaderName ?? 'default';

fetchLoaderData<T>(
  loaderRef.__moduleKey!,
  loaderName,
  { path: location.path, pathParams: ..., searchParams: ... },
  newAbortSignal(),
  { onChunk, onError, onEnd }
)
```

- [ ] **Step 5: Update `loader-stub.ts` to use the new signature**

Replace the stub's `fn` from Task 11 with:

```ts
import { fetchLoaderData } from './loader-fetch.js';

const fn = async ({ location, signal }: { location: any; signal?: AbortSignal }) =>
  fetchLoaderData(
    opts.__moduleKey,
    opts.__loaderName,
    {
      path: location.path,
      pathParams: location.pathParams,
      searchParams: location.searchParams,
    },
    signal ?? new AbortController().signal,
    { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
  );
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @hono-preact/iso test loader-fetch -- --run`
Expected: PASS.

Run all iso tests:

Run: `pnpm --filter @hono-preact/iso test -- --run`
Expected: PASS for what we wrote; existing fixture tests that haven't been migrated yet will still fail; those land in Phase 5.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/loader-fetch.ts packages/iso/src/internal/loader.tsx packages/iso/src/internal/loader-stub.ts packages/iso/src/internal/__tests__/loader-fetch.test.ts
git commit -m "refactor(iso): fetchLoaderData takes module + loader as separate args"
```

---

## Phase 4; definePage simplification

### Task 14: Remove `loader` and `fallback` from definePage signature

**Files:**
- Modify: `packages/iso/src/define-page.tsx`
- Modify: `packages/iso/src/page.tsx`
- Test: `packages/iso/src/__tests__/define-page.test.tsx` (existing, will need migration in Task 21; for this task, just ensure the compilation-level change is good)

- [ ] **Step 1: Update `packages/iso/src/define-page.tsx`**

```ts
export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?:
    | JSX.Element
    | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook> {
  const PageRoute: FunctionComponent<RouteHook> = (location) => (
    <Page
      Wrapper={bindings?.Wrapper}
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

(Drop the `<T>` generic; Page no longer carries loader data through.)

- [ ] **Step 2: Update `packages/iso/src/page.tsx`**

Open the file and:
- Drop `loader`, `fallback` from `PageProps`.
- Remove the `<Loader>` wrapping. The Page now renders just `<Wrapper><ErrorBoundary>{children}</ErrorBoundary></Wrapper>` (or whatever the existing chain is, without the loader layer).
- Drop the generic `<T>` if present.

The exact diff depends on the current shape of `Page`; read the file first and remove the loader-aware branches. The data context, error context, reload context, and Suspense boundary are now owned by `LoaderRef.Boundary` (per loader), not by `Page`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm --filter @hono-preact/iso typecheck` (or `tsc --noEmit` from the iso directory).
Expected: Compilation errors will appear in test files and call sites that still use `definePage({ loader, fallback })`. These get migrated in Tasks 18-21.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/define-page.tsx packages/iso/src/page.tsx
git commit -m "refactor(iso): remove loader/fallback from definePage signature"
```

---

## Phase 5; Migration

The following tasks rewrite call sites to the new API. None should produce behavior changes; they are syntactic-shape migrations. Run tests after each task; some tests in earlier tasks were red because they depended on legacy shapes.

### Task 15: Migrate `apps/app/src/pages/movie.{ts,tsx}`

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`
- Modify: `apps/app/src/pages/movie.tsx`

- [ ] **Step 1: Rewrite `movie.server.ts`**

Replace:

```ts
export default serverLoader;
export const loader = defineLoader<DetailStream>(serverLoader);

export const serverActions = { /* ... */ };
```

with:

```ts
export const serverLoaders = {
  default: defineLoader<DetailStream>(serverLoader),
};

export const serverActions = { /* ... */ };
```

(Drop the `export default serverLoader;` line; the default export is no longer part of the API.)

- [ ] **Step 2: Rewrite `movie.tsx`**

Replace:

```tsx
import { loader, serverActions, type DetailStream } from './movie.server.js';
// ...
const data = loader.useData();
const error = loader.useError();
// ...
useOptimisticAction(serverActions.toggleWatched, {
  invalidate: [loader, moviesListLoader, watchedLoader],
});
// ...
export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
```

with:

```tsx
import { serverLoaders, serverActions, type DetailStream } from './movie.server.js';
import { serverLoaders as moviesListLoaders } from './movies-list.server.js';
import { serverLoaders as watchedLoaders } from './watched.server.js';

const movieLoader = serverLoaders.default;
const moviesListLoader = moviesListLoaders.default;
const watchedLoader = watchedLoaders.default;

// inside MovieDetail:
const data = movieLoader.useData();
const error = movieLoader.useError();
// ...
useOptimisticAction(serverActions.toggleWatched, {
  invalidate: [movieLoader, moviesListLoader, watchedLoader],
});

// at the bottom; wrap MovieDetail in the loader's View since the page-level
// fallback (formerly `definePage({ fallback })`) now lives on the loader binding:
const MovieDetailWithData = movieLoader.View(
  ({ data, error }) => <MovieDetail data={data} error={error} />,
  { fallback: <MoviePageSkeleton /> }
);
export default definePage(MovieDetailWithData, { Wrapper: MovieWrapper });
```

(Adjust `MovieDetail`'s signature to accept `data: DetailStream` and `error: Error | null` as props instead of using the hooks. Skeleton component is whatever the page used before; if the existing demo had no page-level skeleton, use `null` as the fallback.)

For the in-component `loader.useData()` / `loader.useError()` references inside `NotesForm` and `PhotoForm`, switch them to use `movieLoader.useData()` etc.; they're inside the `View`'s subtree so the data context is available.

- [ ] **Step 3: Run app build to verify**

Run: `pnpm --filter app build`
Expected: PASS. If TypeScript errors appear from the loader/serverLoaders rename in other call sites, fix in subsequent migration tasks.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/movie.tsx
git commit -m "refactor(app): migrate movie page to serverLoaders + .View"
```

### Task 16: Migrate `apps/app/src/pages/movies-list.{ts,tsx}`

**Files:**
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Modify: `apps/app/src/pages/movies-list.tsx`

- [ ] **Step 1: Apply the same shape transformation as Task 15**

In `.server.ts`:

```ts
export const serverLoaders = {
  default: defineLoader<MoviesList>(serverLoader),
};
```

In `.tsx`:

```tsx
import { serverLoaders } from './movies-list.server.js';
const moviesLoader = serverLoaders.default;

// ... use moviesLoader.useData() / .useError() inside the .View render fn.

const MoviesListWithData = moviesLoader.View(
  ({ data }) => <MoviesList data={data} />,
  { fallback: <MoviesListSkeleton /> }
);
export default definePage(MoviesListWithData);
```

- [ ] **Step 2: Build**

Run: `pnpm --filter app build`
Expected: PASS (or surface remaining migration sites).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/movies-list.server.ts apps/app/src/pages/movies-list.tsx
git commit -m "refactor(app): migrate movies-list page to serverLoaders + .View"
```

### Task 17: Migrate `apps/app/src/pages/watched.{ts,tsx}`

**Files:**
- Modify: `apps/app/src/pages/watched.server.ts`
- Modify: `apps/app/src/pages/watched.tsx`

- [ ] **Step 1: Same shape transformation**

Apply the same conversion. In `.server.ts`:

```ts
export const serverLoaders = {
  default: defineLoader<WatchedList>(serverLoader),
};
```

In `.tsx`, replace `loader.useData()` with `serverLoaders.default.useData()` (or destructure at top), wrap in `.View`, drop `definePage({ loader, fallback })` arguments.

- [ ] **Step 2: Build**

Run: `pnpm --filter app build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/watched.server.ts apps/app/src/pages/watched.tsx
git commit -m "refactor(app): migrate watched page to serverLoaders + .View"
```

### Task 18: Migrate iso package tests

**Files:**
- Modify: `packages/iso/src/__tests__/define-page.test.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`
- Modify: `packages/iso/src/__tests__/define-loader.test.ts`
- Modify: `packages/iso/src/internal/__tests__/loader.test.tsx`
- Modify: `packages/iso/src/internal/__tests__/loader-streaming.test.tsx`

- [ ] **Step 1: For each file, locate uses of the legacy API and rewrite**

Patterns to find and replace:
- `definePage(C, { loader, fallback })` → `definePage(loader.View(({ data }) => <C data={data} />, { fallback }))`
- `loader.useData()` inside a page test that previously got data via `definePage({ loader })` → wrap the rendered tree in the loader's `.Boundary` (or use `.View`) so the data context is provided.
- Tests that pass `location` prop to `<Loader>` directly → wrap in `RouteLocationsProvider` with `moduleKey: ref.__moduleKey, location: <the test location>`.
- `defineLoader(fn)` calls with no `__moduleKey` → still valid; `__id` is unkeyed.

For each test file, read it, identify the specific call sites, and apply the transformation. The behavior under test should not change; only the harness/setup code changes.

- [ ] **Step 2: Run tests file by file**

Run: `pnpm --filter @hono-preact/iso test define-page -- --run`
Run: `pnpm --filter @hono-preact/iso test page -- --run`
Run: `pnpm --filter @hono-preact/iso test define-loader -- --run`
Run: `pnpm --filter @hono-preact/iso test loader -- --run` (matches `loader.test.tsx` and `loader-streaming.test.tsx`)
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__ packages/iso/src/internal/__tests__
git commit -m "test(iso): migrate test fixtures to serverLoaders + RouteLocationsContext"
```

### Task 19: Migrate Vite plugin tests

**Files:**
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`
- Modify: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`
- Modify: `packages/vite/src/__tests__/path-key-parity.test.ts`
- Modify: `packages/vite/src/__tests__/fixtures/leak-test/pages/foo.server.ts`

- [ ] **Step 1: Update `server-only-plugin.test.ts`**

- Replace assertions about default-import → loader stub with assertions that the import throws.
- Replace `loader` named-import assertions with `serverLoaders` Proxy assertions.
- Keep the `serverGuards`/`serverActions`/`actionGuards` tests intact.
- The "leaves non-server imports untouched" test stays unchanged.

- [ ] **Step 2: Update `server-loader-validation-plugin.test.ts`**

If this plugin still validates `defineLoader` shapes (separate from server-only), check whether it now needs to walk into `serverLoaders` objects. If so, mirror the AST walk in Task 10. If the plugin only validates top-level direct exports, deprecate or update the rule set.

Read the file first to determine the scope of the change.

- [ ] **Step 3: Update `path-key-parity.test.ts`**

This test asserts that the moduleKey emitted by `serverOnlyPlugin` matches the `__moduleKey` injected by `moduleKeyPlugin`. After our changes, the parity is at the `${moduleKey}::${name}` level for serverLoaders entries. Update the test to assert the composite parity for at least one named entry.

- [ ] **Step 4: Update the fixture `leak-test/pages/foo.server.ts`**

Convert to serverLoaders shape:

```ts
import { defineLoader } from '@hono-preact/iso';
export const serverLoaders = {
  default: defineLoader(async () => ({ ok: true })),
};
```

- [ ] **Step 5: Run all vite tests**

Run: `pnpm --filter @hono-preact/vite test -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/__tests__
git commit -m "test(vite): migrate plugin tests to serverLoaders allowlist"
```

### Task 20: Migrate server package tests

**Files:**
- Modify: `packages/server/src/__tests__/loaders-handler.test.ts`
- Modify: `packages/server/src/__tests__/render-stream.test.tsx`

- [ ] **Step 1: Update `loaders-handler.test.ts`**

- Replace request bodies that send `{ module, location }` with `{ module, loader, location }`.
- Replace fixture modules that exported `{ default: fn }` with `{ serverLoaders: { default: fn } }` (and `__moduleKey` on the module).

- [ ] **Step 2: Update `render-stream.test.tsx`**

If this test renders a page tree via `definePage({ loader })`, migrate it to use `loader.View` and wrap the tree in `RouteLocationsProvider`.

- [ ] **Step 3: Run all server tests**

Run: `pnpm --filter @hono-preact/server test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__
git commit -m "test(server): migrate handler + render tests to serverLoaders dispatch"
```

### Task 21: Update prose docs

**Files:**
- Modify: `apps/app/src/pages/docs/loaders.mdx`
- Modify: `apps/app/src/pages/docs/streaming.mdx`
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/quick-start.mdx`
- Modify: `apps/app/src/pages/docs/pages.mdx`
- Modify: `apps/app/src/pages/docs/reloading.mdx`

- [ ] **Step 1: For each file, update code samples and prose**

- Replace `export const loader = defineLoader(...)` examples with `export const serverLoaders = { default: defineLoader(...) }`.
- Replace `definePage(C, { loader, fallback })` with the `.View` factory pattern.
- Add a section in `loaders.mdx` covering: container shape, the `.View` factory (with prop-passthrough generic), the `.Boundary` escape hatch, the `params` opt for search-param dependencies, layout-level loaders.
- Update `structure.mdx` to mention that `layout.server.ts` is now valid and what its scope means.
- Adjust `streaming.mdx` examples that show single-loader pages.

- [ ] **Step 2: Smoke test docs render**

Run: `pnpm --filter app dev` and visit each docs page in a browser. Confirm code samples render and prose flows.

(If MDX builds at compile time, also run `pnpm --filter app build`.)

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs
git commit -m "docs: update loaders + streaming + structure + quick-start prose to multi-loader API"
```

---

## Phase 6; End-to-end verification

### Task 22: Full test suite

- [ ] **Step 1: Run the entire workspace test suite**

Run: `pnpm -w test --run`
Expected: PASS for all packages.

If any test fails, identify the package, fix the migration that was missed, commit per package.

- [ ] **Step 2: Commit fixes if any**

(One commit per logical fix.)

### Task 23: Build verification

- [ ] **Step 1: Build all packages**

Run: `pnpm -w build`
Expected: PASS.

- [ ] **Step 2: Build the demo app**

Run: `pnpm --filter app build`
Expected: PASS, no warnings about unrecognized exports.

### Task 24: Dev-server smoke test

- [ ] **Step 1: Start the demo app**

Run: `pnpm --filter app dev` (in one terminal)

- [ ] **Step 2: Manually verify in a browser**

Navigate to:
- `/movies`; list page renders, loader fires once.
- `/movies/123`; detail page renders, loader streams.
- `/movies/123` then back to `/movies`; list refetches (or uses cache); detail unmounts cleanly.
- `/watched`; page renders.

Open the Network tab and confirm POST `/__loaders` requests carry `{ module, loader, location }` bodies.

(No automated test for this; check manually and report findings in the task notes.)

### Task 25: Demonstrate multi-loader on one page (validation)

This task is OPTIONAL and not strictly required for the spec to land, but it validates the surface end-to-end.

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts` and `movie.tsx`

- [ ] **Step 1: Split the existing single cumulative loader into 3 named loaders**

Now that the API supports it, restructure `movie.server.ts`:

```ts
export const serverLoaders = {
  summary: defineLoader<MovieSummary>(async ({ location }) => /* ... */),
  cast: defineLoader<CastList>(async function* ({ location }) { /* ... */ }),
  similar: defineLoader<SimilarList>(async ({ location }) => /* ... */),
};
```

In `movie.tsx`, create three separate `.View`s for each section and compose them. The page should stream each section independently with its own Suspense fallback.

- [ ] **Step 2: Smoke test**

Reload `/movies/123` in the browser. Confirm three independent skeletons resolve at independent rates (cast streams progressively; summary and similar resolve as they're ready).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/movie.tsx
git commit -m "demo(app): split movie page into three independent streaming loaders"
```

---

## Phase ordering notes

The phases above are logically grouped, but their tasks have some cross-dependencies. **Recommended execution order:**

1. **Task 5** (RouteLocationsContext); no deps; tests in Tasks 3/4 reference it.
2. **Tasks 1, 2** (defineLoader opts + serializeLocation); independent foundation.
3. **Tasks 3, 4** (Boundary, View); depend on Task 5.
4. **Tasks 6, 7** (defineRoutes plumbing + layout-server); depend on Task 5.
5. **Task 8** (LoaderHost reads from context); depends on Task 3.
6. **Tasks 9, 10** (handler + plugin); independent of above; can run in parallel but should land in this order to avoid temporary inconsistency on the wire.
7. **Tasks 11, 12, 13** (stub + Proxy + composite key in fetch); depend on Tasks 9 and 10.
8. **Task 14** (definePage simplification); depends on Tasks 3/4.
9. **Tasks 15-21** (migration); depend on all of the above.
10. **Tasks 22-25** (verification); final.

If executing via subagent-driven-development, dispatch tasks in dependency order. If batching, group: `[5, 1, 2]` → `[3, 4, 6, 7]` → `[8, 9, 10]` → `[11, 12, 13, 14]` → `[15, 16, 17]` → `[18, 19, 20, 21]` → `[22, 23, 24, 25]`.
