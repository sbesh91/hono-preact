# `definePage`: Page-Owned Route Bindings

**Date:** 2026-04-30
**Status:** Draft

## Problem

`iso.tsx` grows linearly with the route count, and each new page costs three lines of central-registry boilerplate:

```tsx
import { loader as moviesLoader, cache as moviesCache } from './pages/movies.server.js';
const Movies = lazy(() => import('./pages/movies.js'));
<Route path="/movies" component={Movies} loader={moviesLoader} cache={moviesCache} />
```

The friction is concrete:

- A named import per `.server.ts`, with `as`-rename to avoid identifier collisions across pages.
- `loader=`/`cache=`/`Wrapper=` props plumbed through `<Route>` per route declaration.
- The `.server.ts` file is referenced from two places (the page component for actions, and `iso.tsx` for the loader/cache binding) — duplicated knowledge of which page goes with which server file.

The page component file is also impure: it must import the loader as a runtime value (`useLoaderData(loader)`) so that `<Route>` and the page agree on which loader is in scope.

We want the route table in `iso.tsx` to deal in *paths and components only*, the page file to *own its data and rendering bindings*, and the page component itself to be *purely presentational* — no runtime imports of the loader ref.

We are explicitly **not** moving to file-based routing. The path table stays declarative and central in `iso.tsx`.

## Goal

A single helper, `definePage`, lets a page module bind its loader/cache/Wrapper directly to the component it exports as default. `<Route>` introspects the resolved component for these bindings; `iso.tsx` no longer imports anything from `*.server.ts` files.

`useLoaderData()` becomes argument-free and reads from the nearest loader context. Type narrowing comes from a type-only import: `useLoaderData<typeof loader>()`.

The two-stage suspense (lazy chunk first, then loader RPC) is accepted as the cost of co-locating the binding with the component. Prefetch-on-hover (already supported by the framework) is the mitigation that makes the cold-navigation latency acceptable in practice.

## Target Shape

```ts
// movies.server.ts — server-only module (Vite plugin stubs to RPC on client)
const serverLoader = async () => ({ movies: await getMovies() });
export default serverLoader;

export const loader = defineLoader('movies', serverLoader);
export const cache = createCache('movies');
export const serverActions = { /* unchanged */ };
```

```tsx
// movies.tsx — pure component, owns its bindings via the default export
import { definePage, useLoaderData } from '@hono-preact/iso';
import { loader, cache } from './movies.server.js';

function Movies() {
  const { movies } = useLoaderData<typeof loader>();
  return <ul>{movies.map((m) => <li key={m.id}>{m.title}</li>)}</ul>;
}

export default definePage(Movies, { loader, cache });
```

```tsx
// movies.tsx — variant with a custom Wrapper
import { definePage } from '@hono-preact/iso';
import { loader, cache } from './movie.server.js';

function Movie() { /* ... */ }
function MovieWrapper(props) { return <article {...props} />; }

export default definePage(Movie, { loader, cache, Wrapper: MovieWrapper });
```

```tsx
// iso.tsx — paths and lazy component refs only
import { lazy, Route, Router } from '@hono-preact/iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Movies = lazy(() => import('./pages/movies.js'));
const Watched = lazy(() => import('./pages/watched.js'));

export const Base = () => (
  <Router>
    <Route path="/" component={Home} />
    <Route path="/movies" component={Movies} />
    <Route path="/movies/*" component={Movies} />
    <Route
      path="/watched"
      component={Watched}
      fallback={<p class="p-1">Loading watched list…</p>}
    />
    {/* mdx routes omitted — unchanged */}
    <NotFound />
  </Router>
);
```

## Components

### 1. `definePage` helper (new)

**File:** `packages/iso/src/define-page.ts`
**Export:** added to `packages/iso/src/index.ts`

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

`definePage` *mutates* the passed component to attach the bindings under a realm-wide symbol (`Symbol.for(...)`) so duplicate module copies (HMR, pnpm phantom deps) still match. The function returns the same component reference — there is no wrapper, no extra render layer.

Pages with no bindings (`Home`, `Test`, `NotFound`) **do not call `definePage`** at all. The framework treats absence of `[PAGE_BINDINGS]` as "no loader, no cache, default Wrapper." This avoids paying a function call for nothing.

### 2. `<Route>` introspection (changed)

**File:** `packages/iso/src/route.tsx`

`<Route>` keeps its current marker-component shape and still drops `loader`/`cache`/`Wrapper` from its prop surface — those move to `definePage`. The Route prop surface becomes:

```ts
export type RouteProps = {
  path: string;
  component: ComponentType;
  fallback?: JSX.Element;             // route-level — kept on Route, not on page
  errorFallback?: PageProps['errorFallback'];  // route-level
  serverGuards?: GuardFn[];           // unchanged
  clientGuards?: GuardFn[];           // unchanged
};
```

`<Router>`'s transform of `<Route>` children no longer reads `loader`/`cache`/`Wrapper` from `<Route>` props. Instead, `wrapWithPage` produces a route handler that:

1. Resolves the lazy component (suspends while the chunk loads — this is the existing preact-iso `lazy` behavior).
2. Reads `[PAGE_BINDINGS]` off the resolved component.
3. Renders `<Page loader={bindings.loader} cache={bindings.cache} Wrapper={bindings.Wrapper} fallback={routeFallback} ...>`.

Since `lazy()` only exposes the resolved value mid-render (via Suspense), the practical implementation is a small `<PageBoundary>` component that does the lookup at render time after `<Component />` has resolved. The implementation may extend or wrap `lazy()` to expose a thenable for the bindings; the choice is left to the implementation plan.

For non-lazy components, `[PAGE_BINDINGS]` is readable synchronously and the lookup is a no-op cost.

`fallback` stays on `<Route>` because the same component can be mounted at two paths with different fallbacks (e.g. `/movies` and `/movies/*`) and a page-level fallback would force them to coincide.

### 3. `useLoaderData()` argument-free (changed)

**File:** `packages/iso/src/use-loader-data.ts`

```ts
import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

export function useLoaderData<L>(): L extends LoaderRef<infer T> ? T : L {
  const ctx = useContext(LoaderDataContext);
  if (!ctx) {
    throw new Error('useLoaderData must be called inside a <Loader> (i.e. a route page with a loader)');
  }
  return ctx.data as never;
}
```

The runtime ref-identity check (`ctx.refId !== ref.__id`) is removed. The hook reads the nearest loader context's data and returns it. Callers narrow the type with `useLoaderData<typeof loader>()` using a type-only import — `L` resolves to `LoaderRef<T>`, the conditional unwraps `T`. If a caller passes a non-`LoaderRef` type (`useLoaderData<MyData>()`), `L` is returned as-is — so hand-written data types work too.

The dropped runtime check is a small safety regression, accepted: the practical case it caught (using the wrong ref) is rare, and the type system catches the same class of bug at compile time.

### 4. `LoaderDataContext.refId` (removed)

**File:** `packages/iso/src/contexts.ts`, `packages/iso/src/loader.tsx`

Today `LoaderDataContext` carries `{ refId, data }` so `useLoaderData(ref)` can verify the ref matches the data. With ref-free `useLoaderData()`, `refId` is unused. Drop it from the context shape; `<Loader>` only provides `{ data }`. This is purely internal — no public API change beyond `useLoaderData`.

### 5. Vite plugin: no change

**File:** `packages/vite/src/server-only.ts`

The plugin already stubs `loader`, `cache`, and `serverActions` named imports from `*.server.*`. No new specifiers are introduced by this design. `definePage` lives in `@hono-preact/iso` (a regular client package), so the page file imports it as a normal value.

### 6. Server / SSR behavior: no change

**Files:** `packages/server/src/loaders-handler.ts`, `packages/server/src/render.tsx`

Server-side loader dispatch still keys off the `module` field in the RPC body and reads the default export of the matched `.server.ts`. `definePage` is a client-side concern that attaches metadata to a *component* — it does not interact with the server's module map.

During SSR, `<Route>` introspection works identically to client-side: the resolved page component is walked for `[PAGE_BINDINGS]` and the loader is invoked directly (not via RPC) before render.

### 7. Nested routers

Nested `<Router>` blocks (e.g. the inner `<Router>` inside `movies.tsx` that mounts `/movies/:id`) are unaffected. `<Router>` and `<Route>` keep their semantics; only the source of bindings changes. A nested route declaration goes from:

```tsx
// today, inside movies.tsx
const Movie = lazy(() => import('./movie.js'));
function MovieWrapper(props) { return <article {...props} />; }

<Router>
  <Route path="/:id" component={Movie} loader={movieLoader} Wrapper={MovieWrapper} />
  <Noop />
</Router>
```

to:

```tsx
// after, inside movies.tsx
const Movie = lazy(() => import('./movie.js'));

<Router>
  <Route path="/:id" component={Movie} />
  <Noop />
</Router>
```

`MovieWrapper` and the loader/cache bindings move into `movie.tsx`'s `definePage` call. This is a coherence win independent of the convenience: `MovieWrapper` describes how the Movie page wraps *itself* — it was always page-internal, and today's arrangement leaks that concern into whichever parent happens to mount it.

Two- and three-level nesting follow the same pattern; bindings always live with the page being mounted, never with the route declaration that mounts it.

### 8. App migration

**Files:** every `apps/app/src/pages/*.tsx` that currently calls `useLoaderData(loaderRef)`, plus `apps/app/src/iso.tsx`.

Per page:
- Import `definePage` from `@hono-preact/iso`.
- Replace the bare `export default Movies` with `export default definePage(Movies, { loader, cache });` (and `Wrapper` where applicable).
- Convert `useLoaderData(loaderRef)` to `useLoaderData<typeof loader>()`. The value-imports of `loader`/`cache` remain for the `definePage` call; the page no longer needs to thread the ref through `useLoaderData`.

Pages with no loader (`home.tsx`, `test.tsx`, `not-found.tsx`) need no changes.

In `iso.tsx`:
- Drop every `import { loader as ..., cache as ... } from './pages/*.server.js'`.
- Drop every `loader=`/`cache=`/`Wrapper=` prop on `<Route>`.

Movie detail page (`movie.tsx`) currently passes `Wrapper={MovieWrapper}` from `movies.tsx`'s nested `<Router>`. The `Wrapper` moves into `movie.tsx`'s `definePage` call.

## Trade-offs Accepted

1. **Lazy chunk fetch precedes loader RPC.** Total navigation work is now `chunk + loader` instead of `max(chunk, loader)`. Mitigated by prefetch-on-hover. Conventional for any framework that co-locates data needs with components (Astro, RSC).

2. **Lost runtime ref-identity check in `useLoaderData`.** The check today catches "you passed the wrong loader ref to `useLoaderData`." With argument-free `useLoaderData`, the type system replaces the runtime check. Low impact.

3. **`definePage` mutates its argument.** Attaching the bindings symbol to the component itself avoids a wrapper component (no extra render layer) but does mean the function has a side-effect on its input. Documented as part of the API. Calling `definePage(Component)` more than once is idempotent (same bindings overwritten); calling it on the same component with different bindings would replace them — practical risk is negligible since each component is defined and bound in one file.

## Out of Scope

- **Generated route types.** Per-route type augmentation (so `useLoaderData()` infers without `<typeof loader>`) is deferred. The user is movable on this for future work, but it requires codegen machinery that is heavier than the gain.
- **`fallback` migration into `definePage`.** Considered and rejected — same component at two paths can want different fallbacks. Stays on `<Route>`.
- **Auto-pairing of `.tsx`/`.server.ts` files via Vite.** Considered as a way to elide the `import { loader, cache }` line in the page file. Rejected as filesystem-pair magic adjacent to file-based routing, which the user has chosen to avoid.
- **Eliminating the duplicate `<Route path="/movies">` and `<Route path="/movies/*">` declarations.** A real nested-router pattern (`<Route path="/movies"><Route path=":id" .../></Route>`) is a separate concern from page-binding ownership and would warrant its own design.
- **`serverGuards`/`clientGuards`/`actionGuards` migration into `definePage`.** They could plausibly move; deferred to a follow-up if the pattern proves out.
- **Backward compatibility shim.** `<Route loader={x} cache={y}>` props are removed in this change; pages migrate in the same commit. There is no parallel-old-and-new API window.

## Open Implementation Questions (for the plan, not this spec)

- Exact mechanism for reading `[PAGE_BINDINGS]` off a lazy component — extend `lazy()`, wrap it, or peek at the resolved value during the `<PageBoundary>` render. The implementer chooses.
- Whether to preserve a development-mode warning when a `<Route>` references a component without `[PAGE_BINDINGS]` *and* without an explicit "this page has no loader" marker. Probably no — absence is unambiguous and warning would be noise for `Home`/`Test`/`NotFound`.
