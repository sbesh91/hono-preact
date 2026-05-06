# Framework Simplification: Trimming the `iso` Surface

**Date:** 2026-05-04
**Status:** research, exploratory
**Companion to:** `2026-04-26-iso-page-composability.md`, `2026-04-26-iso-page-direction-2-hooks.md`, `2026-04-26-iso-page-direction-3-components.md`

---

## TL;DR

`@hono-preact/iso` shipped both a granular component kit (directions #2 and #3 of the prior research) **and** a `definePage`-driven convenience layer on top, exporting roughly 30 named primitives from `index.ts`. Consumers feel the surface, not the internal cleanup. This doc proposes a coordinated cleanup with two strands:

1. **Surface trim** (the original "middle path"): keep `definePage` and the granular `<Page>` escape, delete the magical `Route`/`Router`/`wrapWithPage`/`PAGE_BINDINGS` orchestration on top, re-export `Route`/`Router`/`lazy` as trivial passthroughs of `preact-iso`, and demote rarely-used pieces to a `@hono-preact/iso/internal` subpath.
2. **Path-keyed module identity**: replace the basename-as-routing-key convention used by `loadersHandler` / `actionsHandler` with a path-derived module key embedded into each `.server.*` file at build time by the Vite plugin. The same key drives RPC routing, `__id` Symbol identity, and HMR. Eliminates the implicit "no two `.server.*` files may share a basename" constraint by construction; eliminates `defineLoader`'s string-name argument entirely.

Net public surface drops from ~30 to ~17 names. App churn is small (one comment removed in `iso.tsx`, one `fallback` moved into a `definePage` binding, every `defineLoader('name', fn)` loses its string).

---

## 1. The audit

### 1.1 Surface count

`packages/iso/src/index.ts` exports 30+ names (excluding pure type re-exports):

```
Page, Loader, Envelope, RouteBoundary,
Guards, GuardGate, useGuardResult,
defineLoader, definePage, PAGE_BINDINGS,
useLoaderData,
OptimisticOverlay, prefetch,
LoaderIdContext, LoaderDataContext, GuardResultContext,
ReloadContext, useReload,
createCache, runRequestScope, cacheRegistry,
createGuard, runGuards, GuardRedirect,
isBrowser, env,
getPreloadedData, deletePreloadedData,
defineAction, useAction,
ActionGuardError, defineActionGuard,
Form,
useOptimistic, useOptimisticAction,
Route, Router, wrapWithPage,
lazy
```

Most of these are reachable from any page module. The mental cost of "what's the right primitive for X?" grows linearly with this list.

### 1.2 Layered accretion

The package contains two coexisting authoring models:

1. **Granular kit** (decomposed per direction #2/#3): `defineLoader`, `<Page>`, `<Loader>`, `<Envelope>`, `<RouteBoundary>`, `<Guards>`, `<GuardGate>`, `useLoaderData`, `prefetch`, `OptimisticOverlay`, `useOptimistic`, etc.
2. **Convenience HOC layer** on top: `definePage(Component, bindings)` stamps a `Symbol.for`-keyed `PAGE_BINDINGS` property on the component; a custom `<Route>`/`<Router>` from `route.tsx` introspects that symbol (after probing `lazy.getResolvedDefault()` for code-split components) and replaces the marker with `wrapWithPage(component, config)`.

The two layers are independently coherent. Together they double the count of things a consumer sees and create one outright leak: `apps/app/src/iso.tsx:36-37` bypasses the package's own `Route` for `/docs` and uses `preact-iso`'s `IsoRoute` directly, with a multi-line comment explaining why. The convenience layer's per-Route component identity churn would otherwise remount the docs sidebar on every nested route change.

### 1.3 File-level density

```
194  route.tsx            custom Route/Router, fragment flattening, marker symbol, lazy introspection
207  loader.tsx           reload state machine, queued reloads, override data, lazy fetch promise
164  action.ts            fetch/stream dispatch, FormData, action options, action guards
 76  guards.tsx
 86  page.tsx             thin composition over RouteBoundary/Guards/Loader/Envelope
 49  lazy.ts              wrapped preact-iso lazy that exposes getResolvedDefault
... 25 source files, 1488 LOC total
```

`loader.tsx` and `route.tsx` carry the bulk of the cognitive load. `route.tsx` exists almost entirely to wire the `definePage` magic into `preact-iso`'s router. `lazy.ts` exists to make that wiring possible across code-split routes.

### 1.4 The leak in `iso.tsx`

```tsx
// apps/app/src/iso.tsx:29-37
{/* IsoRoute (preact-iso's Route) so both /docs and /docs/* hand the
    same DocsRoute lazy reference to preact-iso. With our @hono-preact/iso
    Route, wrapWithPage would mint a new PageRouteHandler per Route, and
    preact-iso's component-identity check would treat /docs <-> /docs/foo
    as a route change and remount DocsRoute (and the sidebar with it).
    DocsRoute has no definePage bindings, so PageBoundary wrapping isn't
    needed here. */}
<IsoRoute path="/docs" component={DocsRoute} />
<IsoRoute path="/docs/*" component={DocsRoute} />
```

When you ship an abstraction *and* an escape hatch *and* a comment explaining when to use which, the abstraction is doing too much. This is the canary signal for the simplification work.

---

## 2. Goals

1. **Cut the consumer-visible surface in half** without removing any capability the app uses.
2. **Eliminate the `Route`/`Router`/`PAGE_BINDINGS`/`wrapWithPage` orchestration layer.** Keep the names `Route`, `Router`, `lazy` available from `@hono-preact/iso`, but as trivial re-exports of `preact-iso` so consumers don't have to know they came from somewhere else.
3. **Preserve `definePage(Component, bindings)` as the per-page declaration.** It's the most concise call site and the user's preferred shape.
4. **Make the granular kit (`<Loader>`, `<Envelope>`, `<RouteBoundary>`, `<Guards>`, `<GuardGate>`, etc.) reachable for advanced use** without putting them on the front door. Subpath: `@hono-preact/iso/internal`.
5. **Drop one piece of ceremony per page**: make `defineLoader`'s string name optional, since the Vite plugin already infers it from the `.server.ts` filename in its fallback path.

---

## 3. Target shape

### 3.1 Page module

**Before** (today, `apps/app/src/pages/movies.tsx` + `movies.server.ts`):

```tsx
// pages/movies.tsx
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
import { loader, cache, serverActions } from './movies.server.js';
import Noop from './noop.js';

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionComponent = () => {
  const { movies, watchedIds } = useLoaderData<typeof loader>();

  const { mutate, value } = useOptimisticAction(serverActions.toggleWatched, {
    base: watchedIds,
    apply: (current, p) =>
      p.watched ? [...current, p.movieId] : current.filter((id) => id !== p.movieId),
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });

  return <ul>...</ul>;
}
Movies.displayName = 'Movies';

export default definePage(Movies, { loader, cache });
```

```ts
// pages/movies.server.ts
import { createCache, defineAction, defineLoader, type LoaderFn } from '@hono-preact/iso';

const serverLoader: LoaderFn<{ ... }> = async () => ({ ... });
export default serverLoader;

export const loader = defineLoader<{ ... }>('movies', serverLoader);    // explicit name
export const cache = createCache<{ ... }>('movies-list');
export const serverActions = { ... };
```

**After**:

```tsx
// pages/movies.tsx
import {
  cacheRegistry,
  definePage,
  lazy,
  Route,
  Router,
  useLoaderData,
  useOptimisticAction,
} from '@hono-preact/iso';                 // import surface unchanged
import { loader, cache, serverActions } from './movies.server.js';
import Noop from './noop.js';

const Movie = lazy(() => import('./movie.js'));

function Movies() {
  const { movies, watchedIds } = useLoaderData<typeof loader>();

  const { mutate, value } = useOptimisticAction(serverActions.toggleWatched, {
    base: watchedIds,
    apply: (current, p) =>
      p.watched ? [...current, p.movieId] : current.filter((id) => id !== p.movieId),
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });

  return <ul>...</ul>;
}

export default definePage(Movies, { loader, cache });
```

```ts
// pages/movies.server.ts
import { createCache, defineAction, defineLoader } from '@hono-preact/iso';

const serverLoader = async () => ({ ... });
export default serverLoader;

export const loader = defineLoader(serverLoader);    // no name; plugin embeds path key
export const cache = createCache('movies-list');     // explicit; consumer-visible
export const serverActions = { ... };
```

The leaf-level diff is one less argument to `defineLoader`. The Vite plugin transforms this `.server.ts` file at build time to inject a module-level path-derived key (e.g. `pages/movies` for this file, or `pages/admin/movies` for a sibling at `pages/admin/movies.server.ts`); that key drives `__id`, the RPC routing lookup on the server, and the RPC routing emission on the client. See §4.3 for the mechanism. The `LoaderFn` type import goes away (no longer needed when the loader is a single arg) but isn't required to.

### 3.2 Router

**Before** (today, `apps/app/src/iso.tsx`):

```tsx
import type { FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from '@hono-preact/iso';
import { Route as IsoRoute } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));
const DocsRoute = lazy(() => import('./components/DocsRoute.js'));

function onRouteChange() {
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => (
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
    {/* IsoRoute (preact-iso's Route) so both /docs and /docs/* hand the
        same DocsRoute lazy reference to preact-iso. With our @hono-preact/iso
        Route, wrapWithPage would mint a new PageRouteHandler per Route, and
        preact-iso's component-identity check would treat /docs <-> /docs/foo
        as a route change and remount DocsRoute (and the sidebar with it).
        DocsRoute has no definePage bindings, so PageBoundary wrapping isn't
        needed here. */}
    <IsoRoute path="/docs" component={DocsRoute} />
    <IsoRoute path="/docs/*" component={DocsRoute} />
    <NotFound />
  </Router>
);
```

**After**:

```tsx
import { Route, Router, lazy } from '@hono-preact/iso';   // re-exports of preact-iso

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));
const DocsRoute = lazy(() => import('./components/DocsRoute.js'));

export const Base = () => (
  <Router onRouteChange={onRouteChange}>
    <Route path="/" component={Home} />
    <Route path="/test" component={Test} />
    <Route path="/movies" component={Movies} />
    <Route path="/movies/*" component={Movies} />
    <Route path="/watched" component={Watched} />
    <Route path="/docs" component={DocsRoute} />
    <Route path="/docs/*" component={DocsRoute} />
    <NotFound />
  </Router>
);
```

The `IsoRoute` import vanishes. The route-level `fallback` on `/watched` moves into `definePage(WatchedPage, { … })` (see §6.2). The multi-line comment vanishes. `DocsRoute` (which doesn't use `definePage`) and `Movies` (which does) route through the same component, because `definePage`'s output is itself a routable component now.

### 3.3 The `<Page>` escape

**Before**: there is no clean drop-into-`<Page>` escape today. A consumer who wants to bypass `definePage` has two unhappy options:

1. Use the granular `<Loader>` / `<Guards>` / `<Envelope>` / `<RouteBoundary>` directly, which works but pulls in five separate exports and replicates `<Page>`'s composition by hand.
2. Render `<Page>` from inside a component referenced by `<Route>` — but the custom `<Route>` will then call `wrapWithPage` again on the outer component, double-wrapping. Avoidable only by switching that route to `IsoRoute` (the workaround `DocsRoute` already uses).

**After**: `<Page>` is a usable escape directly, because `<Route>` from `preact-iso` no longer wraps anything. A page that needs something `definePage` can't express:

```tsx
import { Page } from '@hono-preact/iso';
import type { RouteHook } from 'preact-iso';
import { loader, cache } from './movie.server.js';

function MoviePage({ location }: { location: RouteHook }) {
  return (
    <Page
      loader={loader}
      cache={cache}
      location={location}
      fallback={<Spinner />}
      errorFallback={(err, retry) => <CustomError error={err} onRetry={retry} />}
    >
      <MovieDetail />
    </Page>
  );
}
```

For consumers who need the granular pieces (per-step Suspense boundaries, distinct fallbacks for guards vs. loader, etc.), `@hono-preact/iso/internal` re-exports `<Loader>`, `<Envelope>`, `<RouteBoundary>`, `<Guards>`, `<GuardGate>`, the four contexts, and the SSR primitives. Not on the front door, but reachable.

---

## 4. Mechanism

### 4.1 `definePage` self-wraps

Today (`define-page.ts:19-27`):

```ts
export function definePage<T>(Component, bindings?) {
  if (bindings) (Component as PageComponent<T>)[PAGE_BINDINGS] = bindings;
  return Component;
}
```

It returns the component unchanged, with a hidden symbol property. The custom `<Route>` later reads it.

After:

```ts
export function definePage<T>(Component: ComponentType, bindings?: PageBindings<T>) {
  const PageRoute = (location: RouteHook) => (
    <Page
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
  PageRoute.displayName = `definePage(${Component.displayName ?? Component.name})`;
  return PageRoute;
}
```

The output is the routable component `(location) => JSX`. `preact-iso` accepts this as its `component` prop without modification. No symbol, no introspection, no two-pass bindings read on lazy resolution.

`PageBindings` widens to include the route-level config that used to live on `<Route>`:

```ts
export type PageBindings<T> = {
  loader?: LoaderRef<T>;
  cache?: LoaderCache<T>;
  Wrapper?: ComponentType<WrapperProps>;
  fallback?: JSX.Element;
  errorFallback?: JSX.Element | ((error: Error, reset: () => void) => JSX.Element);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};
```

### 4.2 Re-exports in place of the custom `Route`/`Router`/`lazy`

`packages/iso/src/route.tsx` (194 lines) is deleted. `packages/iso/src/lazy.ts` (49 lines) is deleted. `index.ts` adds:

```ts
export { Route, Router, lazy } from 'preact-iso';
```

That's the entire replacement.

### 4.3 Path-keyed module identity

Today, three independent moving parts agree (or fail to agree) on a module's identity:

- **Server-side RPC routing** (`packages/server/src/loaders-handler.ts:33`): `result[moduleNameFromPath(filePath)] = mod.default`. Keyed by basename only.
- **Client-side RPC emission** (`packages/vite/src/server-only.ts:206`): plugin emits `{module: <basename>}` in the fetch arrow, AST-extracted from `defineLoader('name', fn)` with a basename fallback.
- **Symbol identity** (`packages/iso/src/define-loader.ts:27`): `Symbol.for('@hono-preact/loader:' + name)`. Stable across module copies via `Symbol.for`.

The shared currency is **basename**, which silently collides if two `.server.*` files share one (`pages/movies.server.ts` and `pages/admin/movies.server.ts` both resolve to `'movies'`). The current explicit-name scheme doesn't defend against this; the basename fallback hits the same outcome.

The proposed scheme keys all three on a **path-derived module key** computed once at build time and embedded into the `.server.*` file itself.

**The key.** For each `.server.*` file, the key is:

```
path.relative(viteRoot, absolutePath).replace(/\.server\.[jt]sx?$/, '')
```

So `<root>/apps/app/src/pages/movies.server.ts` → `apps/app/src/pages/movies`. Stable across builds (pure function of file path), unique per file (path is unique by filesystem invariant), human-readable for debugging.

**Plugin transform of `.server.*` files.** A new transform pass on `.server.*` modules injects the key as a module-level constant and threads it through `defineLoader` / `defineAction` calls:

```ts
// Source:
import { defineLoader, defineAction } from '@hono-preact/iso';

const serverLoader = async () => ({ ... });
export default serverLoader;
export const loader = defineLoader(serverLoader);
export const serverActions = {
  toggleWatched: defineAction(async (_ctx, p) => { ... }),
};
```

```ts
// After plugin transform:
import { defineLoader, defineAction } from '@hono-preact/iso';

export const __moduleKey = 'apps/app/src/pages/movies';

const serverLoader = async () => ({ ... });
export default serverLoader;
export const loader = defineLoader(serverLoader, { __moduleKey });
export const serverActions = {
  toggleWatched: defineAction(async (_ctx, p) => { ... }, { __moduleKey, __action: 'toggleWatched' }),
};
```

`defineLoader(fn, opts?)` and `defineAction(fn, opts?)` accept the second-arg metadata (typed as internal). At runtime they use it to construct `__id = Symbol.for('@hono-preact/loader:' + opts.__moduleKey)`.

**Plugin transform of client-side `.server.*` imports** (existing path, simplified). The fetch arrow now sends the module key directly instead of basename-extracting:

```ts
// Generated client stub for `import { loader } from './movies.server.ts'`:
const loader = {
  __id: Symbol.for('@hono-preact/loader:apps/app/src/pages/movies'),
  fn: async ({ location }) => {
    const res = await fetch('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'apps/app/src/pages/movies', location: { ... } }),
    });
    // ...
  },
};
```

The plugin computes the module key the same way as in the `.server.*` transform — both run from `id` (absolute path) and the resolved Vite root captured in `configResolved`. Same input, same output, no normalization mismatch.

**Server handler change.** `loadersHandler` reads the key from each loaded module's exports rather than computing from the filename:

```ts
async function buildLoadersMap(glob) {
  const result: Record<string, LoaderFn> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod = typeof moduleOrLoader === 'function' ? await moduleOrLoader() : moduleOrLoader;
    if (typeof mod.default === 'function' && typeof mod.__moduleKey === 'string') {
      result[mod.__moduleKey] = mod.default;
    }
  }
  return result;
}
```

`actionsHandler` mirrors the change: it routes by `body.__module` (now the path key) and looks up handlers in a map keyed the same way.

**`defineLoader`'s public API.** With the plugin embedding the key, the consumer-visible API has no name argument:

```ts
export function defineLoader<T>(fn: Loader<T>): LoaderRef<T>;
```

Internally there's an overload for the plugin's transformed call site:

```ts
export function defineLoader<T>(fn: Loader<T>, opts: { __moduleKey: string }): LoaderRef<T>;
```

The second form is not part of the public surface and isn't documented. It's the contract between the plugin and the runtime.

**HMR identity.** The path key is stable across builds and HMR updates (the file's path doesn't change when its contents do). `Symbol.for('@hono-preact/loader:apps/app/src/pages/movies')` is the same in every dev session, every production build, every test run. Server and client agree by construction because both sides derive the key from the same filesystem reference.

**Collision is by construction impossible.** Two distinct `.server.*` files have distinct paths, hence distinct keys. The implicit "no two `.server.*` files may share a basename" constraint disappears. Apps can grow nested page trees freely.

`createCache('movies-list')` keeps its explicit name, unchanged. The cache name is consumer-visible (`cacheRegistry.invalidate('movies-list')` references it from other modules), so there's nothing to auto-derive.

---

## 5. Public surface, before and after

### 5.1 Before (30+ names from `index.ts`)

Listed in §1.1.

### 5.2 After (~17 names from `index.ts`)

```ts
// Page declaration
export { definePage, Page } from './...';
export type { PageBindings, PageProps, WrapperProps } from './...';

// Routing — trivial re-exports of preact-iso
export { Route, Router, lazy } from 'preact-iso';

// Server bindings
export { defineLoader } from './...';                        // (fn) -> LoaderRef; plugin injects __moduleKey
export type { LoaderRef, LoaderCtx, Loader as LoaderFn } from './...';
export { defineAction, defineActionGuard, ActionGuardError } from './...';   // (fn) -> ActionStub; plugin injects __moduleKey + __action
export type {
  ActionStub, UseActionOptions, UseActionResult,
  ActionGuardContext, ActionGuardFn,
} from './...';

// Hooks
export { useLoaderData } from './...';
export { useAction } from './...';
export { useOptimisticAction, useOptimistic } from './...';
export type { OptimisticHandle, UseOptimisticActionOptions, UseOptimisticActionResult } from './...';
export { useReload } from './...';

// Forms
export { Form } from './...';

// Cache + invalidation
export { createCache, cacheRegistry } from './...';
export type { LoaderCache } from './...';

// Guards (definition / signaling)
export { createGuard, GuardRedirect } from './...';
export type { GuardFn, GuardResult, GuardContext } from './...';

// Utilities
export { prefetch } from './...';
export { isBrowser, env } from './...';
```

### 5.3 Demoted to `@hono-preact/iso/internal`

Components and hooks that `<Page>` composes over but consumers rarely touch:

```ts
// packages/iso/src/internal.ts
export { Loader } from './loader.js';
export { Envelope } from './envelope.js';
export { RouteBoundary } from './route-boundary.js';
export { Guards, GuardGate, useGuardResult } from './guards.js';
export { OptimisticOverlay } from './optimistic-overlay.js';
export {
  LoaderIdContext, LoaderDataContext,
  GuardResultContext,
} from './contexts.js';
export { ReloadContext } from './reload-context.js';
export { getPreloadedData, deletePreloadedData } from './preload.js';
export { runRequestScope } from './cache.js';
export { default as wrapPromise } from './wrap-promise.js';
export { runGuards } from './guard.js';
```

Wired via `package.json`:

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

### 5.4 Removed entirely

- `wrapWithPage`, `PAGE_BINDINGS`
- `PageComponent`, `RouteProps`, `RouterProps`, `RouteConfig`, `PageConfig` (types)
- The custom `route.tsx` and `lazy.ts` source files

The corresponding behavior is folded into `definePage` (self-wrapping) and replaced by `preact-iso` (Route/Router/lazy).

---

## 6. App-level changes

`apps/app/` churn is small:

### 6.1 `apps/app/src/iso.tsx`

- Remove `import { Route as IsoRoute } from 'preact-iso'`.
- Remove the docs-route comment and the two `<IsoRoute>` lines.
- Replace with `<Route path="/docs" component={DocsRoute} />` and `<Route path="/docs/*" component={DocsRoute} />` from the package.

`DocsRoute` is not a `definePage` output; it's a plain Preact component. Under the new model, `<Route>` is `preact-iso`'s `Route` directly, which accepts any component. No wrapping happens. No remount problem.

### 6.2 `apps/app/src/pages/watched.tsx`

The only page with route-level config:

```diff
- <Route
-   path="/watched"
-   component={Watched}
-   fallback={<p class="p-1">Loading watched list…</p>}
- />
```

Move the fallback into `definePage`:

```diff
  export default definePage(WatchedPage, {
    loader,
    cache,
+   fallback: <p class="p-1">Loading watched list…</p>,
  });
```

### 6.3 `apps/app/src/pages/*.server.ts`

Drop the explicit `'movies'` / `'watched'` / `'movie'` strings in `defineLoader` calls. The path-keyed scheme has no string-name argument; the plugin transform embeds the key. Mechanical edit across `pages/movies.server.ts`, `pages/watched.server.ts`, `pages/movie.server.ts`.

```diff
- export const loader = defineLoader<{ ... }>('movies', serverLoader);
+ export const loader = defineLoader(serverLoader);
```

`defineAction` calls keep their shape; the plugin will inject `__moduleKey` and `__action` (already implicit in the action stub today via the `serverActions` object pattern).

### 6.4 No other touchpoints

`pages/*.tsx`, `useLoaderData`/`useAction`/`useOptimisticAction` calls, `Form`, `cacheRegistry.invalidate` — all unchanged.

---

## 7. Tradeoffs

### 7.1 Kept

- The granular kit (`<Loader>`, `<Envelope>`, etc.) still exists in source. Anyone who wants direction-#3-style explicit composition imports from `@hono-preact/iso/internal`. The kit is reachable, just not centered.
- `definePage` ergonomics. Single line per page. No new cognitive overhead.
- The `<Page>` escape hatch covers the common "I need a slightly different shape" cases without dropping to internal.
- All hooks (`useLoaderData`, `useAction`, `useOptimisticAction`, `useReload`, `useOptimistic`) keep their signatures.
- All server primitives (`defineLoader`, `defineAction`, `defineActionGuard`, `createCache`, `cacheRegistry`, `createGuard`, `GuardRedirect`) keep their signatures (modulo `defineLoader`'s now-optional name).

### 7.2 Lost

- **The custom `<Route>`/`<Router>`'s implicit "any component with `PAGE_BINDINGS` is a routed page"** behavior. Consumers can no longer drop a non-`definePage` component into a route and have it discover bindings from imports. Replaced by: pages are `definePage` outputs; non-pages are plain components; both go through the same `preact-iso` `<Route>`.
- **The wrapped `lazy()`** with `getResolvedDefault()`. No consumer code reads `getResolvedDefault` today; it exists solely so `<Route>`'s introspection could see post-resolution bindings. Goes away with the introspection.
- **Nine names from `index.ts` move behind `/internal`.** Consumers who were already reaching for them (none, in `apps/app/`) need a one-token import path change.

### 7.3 New risks

Two structural changes carry new risk that need test coverage:

**Plugin transform of `.server.*` files.** `serverOnlyPlugin` currently only transforms client-side imports of `.server.*` modules. Path-keying adds a second pass that transforms the `.server.*` files themselves to inject `__moduleKey` and thread it through `defineLoader` / `defineAction` calls. The transform is small (~20 LOC of `MagicString` work over the existing AST walker), but it's a new code path on the server build. The chief failure mode is: server-side `__moduleKey` and client-side RPC payload disagree, breaking RPC routing silently.

Mitigation: capture `viteRoot` once via `configResolved` and reuse on both transform paths. Add a contract test that loads the same `.server.ts` file under both transform paths in dev and production builds, asserts the keys match.

**`viteRoot` resolution drift.** The path key is computed via `path.relative(viteRoot, absolutePath)`. If `viteRoot` resolves differently in dev vs. build vs. SSR vs. test (e.g., a workspace-root config in monorepos), keys diverge across environments and RPC breaks.

Mitigation: never recompute `viteRoot` from `id` directly; only read the value captured in `configResolved`. Add an integration test that exercises a monorepo layout (already the case here — `apps/app` under a pnpm workspace).

### 7.4 Collision handling

The basename-collision concern from earlier exploration ("two `.server.*` files in different folders sharing a name") is dissolved by path-keying:

- Symbol identity: distinct paths produce distinct `Symbol.for(...)` keys.
- RPC routing: the server handler's lookup map is keyed by path; collisions are filesystem-impossible.
- Cache registry: unaffected — `createCache(name)` is consumer-typed and independent.

No build-time lint check needed; no UUID needed; no hash suffix needed. The collision class goes away.

---

## 8. What this does not solve

The simplification leaves several known issues untouched. They're called out for the next research step, not for this scope.

1. **`useId`-keyed SSR hydration.** `<Loader>` calls `useId()` and `getPreloadedData(id)` matches against a DOM element with that id. Inserting or removing intermediate components anywhere on the path between `<Page>` and `<Loader>` would shift the fiber-position id, breaking hydration. This is fragile and is direction #4's territory: hydrate by loader name, not by `useId()`. Note that the path-keyed module identity from §4.3 is a natural foundation for this: the same `__moduleKey` could key SSR data injection (`<script type="application/json" data-loader-key="apps/app/src/pages/movies">`) and hydration lookup, decoupling SSR from React fiber position. Out of scope here; flagged as the natural next step.
2. **Pipeline ordering is still fixed inside `<Page>`** (guard → preload → cache → fetch). Consumers wanting a different order drop to `@hono-preact/iso/internal` and assemble their own. That's the same as today's "fork `<Page>`" workaround, just better-supported.
3. **`<Page>` itself remains a monolithic orchestrator.** This work moves complexity off the consumer's plate but doesn't reduce the `loader.tsx` or `<Page>` internals. That's a follow-on cleanup, separate from the surface trim.
4. **Streaming SSR, Worker prefetch, and other "iso runs outside React" stories** remain unaddressed. Direction #4 is the path; this doc is not that path.

---

## 9. Migration sketch

A non-prescriptive ordering. The path-keyed routing change ships first because it's the largest structural piece and the surface trim doesn't depend on it landing first; doing it earlier means the test surface stabilizes before the cosmetic changes pile on top.

**Step 1 — Path-keyed module identity.** Extend `serverOnlyPlugin` with a second transform pass that runs on `.server.*` files: inject `export const __moduleKey = '<path>'` and thread the key into `defineLoader` / `defineAction` calls via a hidden second arg. Update the existing client-side import transform to emit the path key in RPC payloads instead of basename. Update `loadersHandler` and `actionsHandler` in `packages/server` to read `mod.__moduleKey` for routing instead of `moduleNameFromPath`. Update `defineLoader` and `defineAction` runtime to accept the hidden options arg and use it for `__id`. Drop `defineLoader`'s string-name argument from the public type. Migrate `apps/app/src/pages/*.server.ts` (mechanical: drop `'movies'` etc.). Test: contract test asserting server-rendered `__moduleKey` matches client-emitted RPC payload across dev and production builds.

**Step 2 — `definePage` self-wraps.** Update `define-page.ts` to return a routable component. `<Page>` keeps its current props. `PAGE_BINDINGS` symbol stays for one transition release. Existing custom `<Route>`/`<Router>` continues to work because the bindings symbol is still set; the path through the marker just becomes redundant.

**Step 3 — Replace `Route`/`Router`/`lazy` with re-exports.** Delete `route.tsx` and `lazy.ts`. Export `Route`, `Router`, `lazy` from `preact-iso` in `index.ts`. `apps/app/src/iso.tsx` cleanup happens here (drop `IsoRoute`, drop comment, no `definePage`-aware route needed).

**Step 4 — Move route-level props to `PageBindings`.** Add `fallback`/`errorFallback`/`serverGuards`/`clientGuards` to `PageBindings`. Migrate `pages/watched.tsx`. Remove the (no-longer-useful) types `RouteProps`, `RouterProps`, `RouteConfig`, `PageConfig`.

**Step 5 — `index.ts` trim.** Move `Loader`, `Envelope`, `RouteBoundary`, `Guards`, `GuardGate`, `useGuardResult`, `OptimisticOverlay`, all four context exports, `getPreloadedData`, `deletePreloadedData`, `runRequestScope`, `wrapPromise`, `runGuards` out of `index.ts` and into `internal.ts`. Add the `package.json` `exports` entry.

**Step 6 — Drop `PAGE_BINDINGS` and `wrapWithPage`.** Delete the symbol and the helper. Remove from public exports. After step 2, nothing reads them anymore.

Step 1 is the riskiest and gets its own PR plus contract tests. Steps 2–6 are mechanically driven by the existing test suite. The surface trim (steps 2–6) is independent of step 1 and could ship first if path-keying needs to bake longer; the only coupling is that step 1 removes `defineLoader`'s string argument, so a deferred step 1 means step 6's `defineLoader(fn)` form needs the optional-name compromise from earlier explorations.

---

## 10. Bottom line

The simplification is a refactor plus one structural change. The refactor deletes the orchestration layer that grew up to make `definePage` invisible, replaces it with a `definePage` that does its own wrapping, and pushes the granular kit behind a subpath import where advanced consumers can still reach it. The structural change retires basename-as-routing-key in favor of path-derived module identity embedded by the plugin, eliminating an implicit constraint and making `defineLoader` a single-arg primitive. The `<Page>` component, the loader/action/optimistic hooks, the cache primitives, and the guard primitives all keep their shape.

Net change for the consumer:

- `index.ts` shrinks from ~30 names to ~17.
- `iso.tsx` loses an escape-hatch import and a six-line comment.
- One page (`watched.tsx`) moves a `fallback` prop from `<Route>` to `definePage` bindings.
- `defineLoader(fn)` is the only form. Every existing `defineLoader('name', fn)` call drops its string.
- Filenames stop being load-bearing for routing. Folders can be organized however the app wants.

Net change for the package:

- Two source files deleted (`route.tsx`, `lazy.ts`), ~243 LOC.
- One source file added (`internal.ts`, ~15 LOC re-exports).
- Two `package.json` exports entries.
- `serverOnlyPlugin` gains a `.server.*` transform pass that injects `__moduleKey` and threads it into `defineLoader` / `defineAction` calls.
- `loadersHandler` and `actionsHandler` switch from basename-keying to `__moduleKey`-keying.

The unreduced complexity (loader state machine, `useId`-keyed hydration, pipeline ordering) is left for direction #4 if and when iso outgrows its current scope. The path-keyed module identity from §4.3 is the natural foundation for `useId`-free SSR hydration when that work begins. This doc's scope is the front door plus the routing-identity layer underneath; both are what consumers feel directly or indirectly when their app grows.
