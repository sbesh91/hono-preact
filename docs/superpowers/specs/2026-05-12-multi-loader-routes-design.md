# Multi-Loader Routes

**Date:** 2026-05-12
**Status:** Draft
**Implements:** Resolution of the two framework gaps captured in memory (`project_streaming_loader_framework_gaps`) surfaced by the movies-streaming demo design (`2026-05-12-movies-streaming-demo-design.md`).

## TL;DR

A page can declare any number of loaders inside a single `.server.*` file, each with its own Suspense boundary, error context, data context, and reload context. Loaders are organized in a `serverLoaders` container symmetric with `serverActions`. Each loader is consumed by a co-located `.View()` factory that produces a self-contained component (boundary + render + fallback in one block). Layout-level `.server.*` files are now supported; a loader's location-scope is determined structurally by which route owns its declaring file, with no opt-in flag required. Search-param dependencies are declared per loader.

```ts
// pages/movies/[id]/page.server.ts
import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  summary: defineLoader(async ({ location }) =>
    db.movies.get(location.pathParams.id)
  ),

  cast: defineLoader(async function* ({ location }) {
    for await (const m of streamCast(location.pathParams.id)) yield m;
  }),

  similar: defineLoader(
    async ({ location }) => fetchSimilar(location.pathParams.id, location.searchParams),
    { params: ['genre'] }
  ),
};
```

```tsx
// pages/movies/[id]/page.tsx
import { definePage } from 'hono-preact';
import { serverLoaders } from './page.server';

const { summary, cast, similar } = serverLoaders;

const Summary = summary.View(
  ({ data, error, reload }) => {
    if (error) return <ErrorBox onRetry={reload} />;
    return <SummaryCard data={data} />;
  },
  { fallback: <SummarySkeleton /> }
);

const Cast = cast.View(
  ({ data }) => <CastList items={data} />,
  { fallback: <CastSkeleton /> }
);

const Similar = similar.View(
  ({ data }) => <SimilarCarousel items={data} />,
  { fallback: <SimilarSkeleton /> }
);

export default definePage(MovieDetail);

function MovieDetail() {
  return (
    <article>
      <Summary />
      <Cast />
      <Similar />
    </article>
  );
}
```

Layout-anchored loaders (a live activity feed that doesn't restart on inner navigation) live in `layout.server.*` and follow the same patterns; their cache identity is automatically the layout's matched location.

## Background

Today, a page may declare at most one loader per `.server.*` file:

1. The `serverOnlyPlugin` allowlist permits only `default, loader, serverGuards, serverActions, actionGuards` as named imports from `.server.*` modules. Any other named export throws at build time.
2. The `/__loaders` RPC handler builds its routing map by `moduleKey -> default`, so even if the allowlist were relaxed, a single file could dispatch to at most one loader.
3. `definePage` accepts a single `loader` binding. Its data is provided through one `LoaderDataContext` per page, so `loader.useData()` cannot disambiguate between siblings.
4. Layout routes reject `server:` declarations (`define-routes.tsx`), so there is no way to anchor a loader at a layout level that stays mounted across child navigation.

These together mean the framework cannot ship the headline streaming-SSR pattern (multiple independent streaming sections per page) or the ambient-data pattern (a layout-level feed that survives inner route changes). The movies-demo PR works around (1)–(3) by collapsing four logical streams into one cumulative-shape generator, losing per-loader Suspense, per-loader error surfaces, and forcing server-side cadence merging; (4) it works around by passing a synthetic constant location to the internal `<Loader>` component.

This design replaces all four mechanisms with one cohesive surface.

## Why this shape

Five decisions, each driven by what the long-term framework user gets.

### 1. Action-symmetric container (`serverLoaders`)

Actions already solved "many things per `.server.*` file" via `serverActions = { ... }`. Loaders adopt the identical container shape. One allowlist entry in the server-only plugin, one Proxy stub on the client, one wire format, one mental model. The developer learns "server-side concerns go in a named container; you import the container and consume named entries" once, and it covers both actions and loaders.

Container always: single-loader pages use `serverLoaders = { default: defineLoader(...) }`. The slight ceremony tax on the simple case is paid back by uniformity. There is no second pattern to learn, no "which export do I use again?" lookup, no plugin special-case for solo loaders.

### 2. `.View()` factory as the primary developer surface

A naive multi-loader API would expose a `<loader.Boundary>` JSX primitive: wrap children, call `useData()` inside. That pattern has real DX costs at scale:

- Spooky coupling: `useData()` only works inside the matching `Boundary`. Move a component, silent break, runtime error.
- Forced sub-componentization to satisfy Suspense topology.
- Repeated fallback declarations at every use site.
- Pages read as wiring diagrams, not as layouts.

`.View()` hides the boundary inside a co-located binding:

```ts
loader.View<P = {}>(
  render: (args: P & { data: T; error: Error | null; reload: () => void }) => ComponentChildren,
  opts?: { fallback?: ComponentChildren; errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren) }
): FunctionComponent<P>
```

Returns a component pre-wrapped in the loader's own Boundary (Suspense + error + data + reload contexts). The render function receives `{ data, error, reload }` plus any props the developer's generic `P` declares. Inside the render fn's subtree, `loader.useData()` / `loader.useError()` still work for descendants that need data without prop drilling.

Pages compose `<Summary />`, `<Cast />`, `<Similar />`: each a single, scannable unit that owns its boundary, fallback, render, and error handling.

The Boundary primitive remains exposed for the 5% case (`<loader.Boundary fallback={...}>...</loader.Boundary>` with `loader.useData()` inside) where the developer needs to interleave loader-aware UI with non-loader content or render outside the data context.

### 3. Structural scope (no opt-in flag)

The original framing had `defineLoader({ scope: 'mount' | 'route' })` to control whether a loader re-runs on location changes. That framing belongs at the wrong layer. A loader's location-scope is already implicit in **which route owns the declaring `.server.*` file**:

- `pages/movies/[id]/page.server.ts` → loader's location is the page's matched location. Refetches when path/relevant-search change.
- `pages/movies/layout.server.ts` → loader's location is the layout's matched location. Refetches only when the layout's match changes (i.e., navigation out of `/movies/*`); stable across `/movies` → `/movies/123`.

The framework already pairs `.server.*` files with route manifest entries during `defineRoutes`. We extend that to expose, at render time, each route's matched location through a context keyed by route-manifest-id. `.View()` reads the context entry corresponding to ITS owning route (resolved from the loader's `__moduleKey`), not the deepest active route's location.

This makes the ambient-feed case (Gap 2) fall out of the file structure: put the loader in `layout.server.ts`, and it's automatically layout-scoped. No new prop, no new API.

Consequence: **layout `.server.*` files become first-class.** The `define-routes.tsx` rejection of `server:` on layout routes is removed. The same actions/loaders/guards machinery applies; only the cache-key wiring differs.

### 4. Path-only cache key with per-loader search-param opt-in

Today the cache key is the full serialized location (`path + sorted searchParams`). That means every search-param change refetches every loader: tracking params (`?utm_source=...`), UI state (`?modal=share`, `?view=grid`), and analytics tags all cause network round trips across loaders that don't care about them. In a large app, this multiplies into hundreds of wasted requests per session.

The new default is **path-only**. Search-param dependencies are declared per loader:

```ts
defineLoader<T>(
  fn: (ctx: LoaderCtx) => Promise<T> | AsyncGenerator<T, void>,
  opts?: { cache?: LoaderCache<T>; params?: string[] | '*' }
): LoaderRef<T>
```

- `params` omitted (default `[]`): cache key includes `path` + `pathParams` only.
- `params: ['genre', 'page']`: cache key also includes those specific search params.
- `params: '*'`: cache key includes all search params (today's behavior, for search/filter pages that genuinely depend on the full query bag).

The RPC request still sends the full location to the server (handlers may want it for logging, headers, or behavior unrelated to caching); only the client-side cache key is narrowed.

Path-params come from the route match and are always included; they ARE the route's identity. Layouts naturally include only their own pathParams (a layout matching `/movies/*` doesn't see `:id`).

### 5. Hard cutover, no compat shim

`loader` as a named export from `.server.*` is removed from the plugin allowlist. `definePage({ loader, fallback })` is removed from the signature. Every existing call site is rewritten in the implementing PR. Memory captures "no schedule pressure on framework design": a clean break beats a compat layer that haunts the codebase. Pre-v0.1, no external users.

## Public API

### `defineLoader`

```ts
export type LoaderCtx = {
  location: RouteHook;        // location at the loader's declaring route level
  signal: AbortSignal;
};

export type Loader<T> =
  | ((ctx: LoaderCtx) => Promise<T>)
  | ((ctx: LoaderCtx) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx) => AsyncGenerator<T, void, unknown>);

export type DefineLoaderOpts<T> = {
  cache?: LoaderCache<T>;
  params?: string[] | '*';
  __moduleKey?: string;        // plugin-emitted; user code does not set
  __loaderName?: string;       // plugin-emitted; user code does not set
};

export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T>;
```

### `LoaderRef<T>`

```ts
export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly __moduleKey?: string;
  readonly __loaderName?: string;
  readonly fn: Loader<T>;
  readonly cache: LoaderCache<T>;

  useData(): T;
  useError(): Error | null;
  invalidate(): void;

  View<P extends Record<string, unknown> = {}>(
    render: (args: P & { data: T; error: Error | null; reload: () => void }) => ComponentChildren,
    opts?: ViewOpts
  ): FunctionComponent<P>;

  Boundary: ComponentType<{
    fallback?: ComponentChildren;
    errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
    children: ComponentChildren;
  }>;
}

type ViewOpts = {
  fallback?: ComponentChildren;
  errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
};
```

`__moduleKey + __loaderName` together identify the loader on the wire. `__id` is `Symbol.for('@hono-preact/loader:${__moduleKey}::${__loaderName}')`, derived for the shared-cache map.

`useData()` reads the data context installed by the loader's own `Boundary` (whether direct or via `View`). Calling `useData()` outside a matching boundary throws with a clear message.

### `serverLoaders` container

In `.server.*` files, loaders are exported in a single named container:

```ts
export const serverLoaders = {
  primary: defineLoader(async ({ location }) => /* ... */),
  secondary: defineLoader(async function* () { /* ... */ }, { params: ['page'] }),
};
```

The plugin recognizes `serverLoaders` as one of the permitted named exports from a `.server.*` module. On the client, the import is stubbed with a Proxy whose `get(_, name)` returns a fresh `LoaderRef` for that name (bound to the file's moduleKey and the access name). On the server, the actual container is loaded and its values are mounted into the RPC dispatch map.

A single-loader page conventionally uses `default`:

```ts
export const serverLoaders = {
  default: defineLoader(async () => fetchPage()),
};
```

There is no special-cased single-loader export. The plugin treats `serverLoaders.default` like any other entry.

### `definePage`

```ts
export type PageBindings = {
  Wrapper?: ComponentType<WrapperProps>;
  errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
};

export function definePage(
  Component: ComponentType,
  bindings?: PageBindings
): FunctionComponent<RouteHook>;
```

`loader` and `fallback` are removed from `PageBindings`. Data wiring lives entirely on `.View()` (or `.Boundary`) inside the page's JSX.

### `defineLayout` (new)

Layout `.server.*` files require a sibling `layout.tsx` that wraps children. Today layouts are declared in route configuration without a top-level binding API; this stays. The change is that the route's `.server.*` may now exist and is loaded with the layout's match. No new public function is required for v1; the existing `defineRoutes`/`Routes` machinery is updated to walk layout-level server modules the same way it walks page-level ones.

(A future `defineLayout` helper analogous to `definePage` may emerge, but is not required by this spec.)

## Wire format

### Client → Server

```
POST /__loaders
Content-Type: application/json

{
  "module": "<moduleKey>",       // e.g. "pages/movies/[id]/page.server"
  "loader": "<loaderName>",      // e.g. "summary"
  "location": {
    "path": "/movies/123",
    "pathParams": { "id": "123" },
    "searchParams": { "tab": "cast" }
  }
}
```

Symmetric with `/__actions`'s `{ module, action, payload }`. The location is the full active location; the server is free to use any of it.

### Server-side dispatch

`loadersHandler` builds its routing map as `{ "<moduleKey>::<loaderName>": loaderFn }`, populated from every `.server.*` file's `serverLoaders` container. Dispatch key for a request: `${body.module}::${body.loader}`. 404 if absent.

### Response format

Unchanged from today: JSON for non-streaming, SSE for streaming generators/readable-streams. The `Loader` host component on the client uses the same `subscribeToLoaderStream` machinery, keyed per-loader (already supported via `useId`).

## Plugin changes

### `packages/vite/src/server-only.ts`

- Drop `loader` from the named-import allowlist.
- Add `serverLoaders` to the allowlist.
- For a `serverLoaders` named import, emit a Proxy stub:

  ```js
  const serverLoaders = new Proxy({}, {
    get(_, name) {
      return __$createLoaderStub_hpiso({
        __moduleKey: "<moduleKey>",
        __loaderName: String(name),
      });
    },
  });
  ```

  `__$createLoaderStub_hpiso` is a new export of `@hono-preact/iso` that constructs a `LoaderRef`-shaped stub whose `fn` is the RPC fetch arrow (action-symmetric with the existing action proxy).

- Update error message for unrecognized named imports to list the new allowlist: `serverLoaders, serverGuards, serverActions, actionGuards`. `default` is also dropped from the allowlist; any existing default-export references in `.server.*` files migrate to `serverLoaders.default`.

### `packages/vite/src/module-key.ts`

No change to `moduleKey` derivation itself. The composite identifier on the wire is constructed at runtime by appending `::<loaderName>` to the `__moduleKey`.

### `packages/vite/src/define-routes` integration (route discovery)

- Relax the rejection of `server:` on layout routes.
- Continue to discover `.server.*` files for both layouts and pages.
- Emit, for each route-id in the manifest, the list of `.server.*` modules it owns.

### `packages/server/src/loaders-handler.ts`

- Update `buildLoadersMap` to walk `serverLoaders` (named export) on each glob entry, producing `{ "<moduleKey>::<name>": fn }` entries.
- The previous `default`-export dispatch path is removed in the same PR; the wire format always carries `loader: string` and the server always resolves on the composite key.
- Request validation: require `module: string`, `loader: string`, `location: SerializedLocation`.

## Runtime changes

### `packages/iso/src/internal/loader.tsx`

The `<Loader>` host already owns one Suspense boundary, error context, data context, and reload context per instance. Three changes:

1. **`useId` per loader instance:** already in place; ensures separate streaming-SSR registry keys per loader on a single page.

2. **Cache-key serialization respects `params`:** `serializeLocation(loc, params)` returns `${path}` when `params` is `[]`, `${path}?${filtered-sorted-search}` when `params` is `string[]`, and `${path}?${all-sorted-search}` when `params` is `'*'`. The `params` value comes from the `LoaderRef` (closed over at `defineLoader` time and threaded by the server-only plugin into the stub).

3. **Location source per loader:** instead of taking `location` as a prop, the `<Loader>` host reads the location of its loader's declaring route from a new context (`RouteMatchLocationContext`, keyed by route-manifest-id). The route-id is resolved at build time from the loader's `__moduleKey` against the route manifest. The render-time context provider is installed by the `Routes` infrastructure at each route level (layout, page).

   - For a loader declared on a page, this resolves to the page's matched location.
   - For a loader declared on a layout, this resolves to the layout's matched location (stable across child route changes).
   - The full active location is still available via `useLocation()` for code that wants it; `<Loader>` just doesn't use it.

### `packages/iso/src/define-loader.ts`

- Accept `params` in opts; persist on the `LoaderRef`.
- `__id` becomes `Symbol.for('@hono-preact/loader:${moduleKey}::${loaderName}')`. Shared-cache map keyed by `__id` as today.
- `useData()` reads from the per-Boundary data context (already keyed by `LoaderIdContext` via the `<Loader>` host's `useId`).
- Add `.View(render, opts)` method on the ref. Implementation:

  ```tsx
  View(render, opts) {
    const Wrapped = (props) => (
      <ref.Boundary fallback={opts?.fallback} errorFallback={opts?.errorFallback}>
        <ViewRenderer ref={ref} props={props} render={render} />
      </ref.Boundary>
    );
    return Wrapped;
  }
  ```

  Where `ViewRenderer` calls `ref.useData()` / `ref.useError()` / the reload-context hook and forwards `{ data, error, reload, ...props }` to `render`.

- Add `.Boundary` component on the ref. Implementation wraps the existing internal `<Loader>` host.

### `packages/iso/src/define-page.tsx`

- Remove `loader` and `fallback` from `PageBindings`.
- `<Page>` no longer wraps in a `<Loader>` for the page-level binding.
- Existing `Wrapper`, `errorFallback`, `serverGuards`, `clientGuards` plumbing is preserved.

### `packages/iso/src/define-routes.tsx`

- Drop the "layout cannot declare server" check.
- When a layout has a `.server.*` sibling, the Routes infrastructure mounts its `RouteMatchLocationContext` provider above its children.
- Discovery of `.server.*` files is extended to emit, for each route in the manifest, the moduleKeys it owns.

## Streaming-SSR integration

Each `.View()` (or `.Boundary`) gets its own `useId` from the internal `<Loader>` host, which is what `streaming-ssr` keys its registry on. Multiple streaming loaders on one page therefore each register their own continuation generator under their own ID; the existing flush machinery already handles many-IDs-per-page. No new SSR primitive needed.

Layout-level streaming loaders work the same way: their `<Loader>` host is mounted in the layout's render tree and gets a `useId`; the SSR shell flushes their first chunk at the layout level, and continued chunks target the same subtree across child route changes (which, on the client, do not unmount the layout's `<Loader>` because its declaring-route location is stable).

## Examples

### Page with three independent streams

```ts
// pages/movies/[id]/page.server.ts
import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  summary: defineLoader(async ({ location }) =>
    db.movies.get(location.pathParams.id)
  ),

  cast: defineLoader(async function* ({ location }) {
    for await (const m of streamCast(location.pathParams.id)) yield m;
  }),

  similar: defineLoader(
    async ({ location }) => fetchSimilar(location.pathParams.id, location.searchParams),
    { params: ['genre'] }
  ),
};
```

```tsx
// pages/movies/[id]/page.tsx
import { definePage } from 'hono-preact';
import { serverLoaders } from './page.server';

const { summary, cast, similar } = serverLoaders;

const Summary = summary.View(
  ({ data, error, reload }) =>
    error ? <ErrorBox onRetry={reload} /> : <SummaryCard data={data} />,
  { fallback: <SummarySkeleton /> }
);

const Cast = cast.View(
  ({ data }) => <CastList items={data} />,
  { fallback: <CastSkeleton /> }
);

const Similar = similar.View(
  ({ data }) => <SimilarCarousel items={data} />,
  { fallback: <SimilarSkeleton /> }
);

export default definePage(MovieDetail);

function MovieDetail() {
  return (
    <article>
      <Summary />
      <Cast />
      <Similar />
    </article>
  );
}
```

### Layout with ambient feed

```ts
// pages/movies/layout.server.ts
import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  activity: defineLoader(async function* ({ signal }) {
    for await (const event of subscribeToActivity(signal)) {
      yield event;
    }
  }),
};
```

```tsx
// pages/movies/layout.tsx
import { serverLoaders } from './layout.server';

const Feed = serverLoaders.activity.View(
  ({ data }) => <ActivitySidebar events={data} />,
  { fallback: null }
);

export default function MoviesLayout({ children }: { children: ComponentChildren }) {
  return (
    <div class="movies-layout">
      <main>{children}</main>
      <aside><Feed /></aside>
    </div>
  );
}
```

Navigating `/movies` → `/movies/123` does NOT unmount the layout, does NOT change the layout's matched location, and therefore does NOT re-fire the `activity` loader. The streaming subscription continues across the route change.

### View with extra props

```tsx
const Summary = summary.View<{ highlight: boolean }>(
  ({ data, highlight }) => (
    <SummaryCard data={data} class={highlight ? 'highlight' : undefined} />
  ),
  { fallback: <SummarySkeleton /> }
);

// Use site:
<Summary highlight={true} />
```

### Boundary as escape hatch

```tsx
function Header() {
  return (
    <summary.Boundary fallback={<HeaderSkeleton />}>
      <HeaderWithSummary />
    </summary.Boundary>
  );
}

function HeaderWithSummary() {
  const data = summary.useData();
  return (
    <header>
      <BreadcrumbTrail />
      <h1>{data.title}</h1>
      <ActionsBar />
    </header>
  );
}
```

## Migration

All migrations are mechanical and performed in the implementing PR. No compat shim.

### Per `.server.*` file with `export const loader = defineLoader(...)`

```diff
- export const loader = defineLoader(async (ctx) => { /* ... */ });
+ export const serverLoaders = {
+   default: defineLoader(async (ctx) => { /* ... */ }),
+ };
```

### Per page using `definePage({ loader, fallback })`

```diff
- import { loader } from './page.server';
- function Page() {
-   const data = loader.useData();
-   return <View data={data} />;
- }
- export default definePage(Page, { loader, fallback: <Skel /> });

+ import { serverLoaders } from './page.server';
+ const Page = serverLoaders.default.View(
+   ({ data }) => <View data={data} />,
+   { fallback: <Skel /> }
+ );
+ export default definePage(Page);
```

### Per page using multiple loader files (the current movies-demo workaround)

Consolidate into one `page.server.ts` with a `serverLoaders` container holding all entries. Remove the synthetic-location plumbing and the internal `<Loader>` imports.

### Per layout that needs a server module

Add `layout.server.ts` with a `serverLoaders` container. Render the View inside the layout component. No further changes; the framework auto-scopes.

### Test fixtures

`packages/iso/src/__tests__/page.test.tsx` and adjacent tests using `definePage({ loader })` migrate to the new shape. Tests calling `defineLoader` directly (without the plugin) continue to work; the `__moduleKey`/`__loaderName` fields are optional, and the test path uses the direct `fn` rather than the RPC stub.

## Out of scope (v1)

- **`combineLoaders([a, b]).View(...)`**: power-user combinator for a single component that needs multiple loaders' data with one combined fallback. Workaround in v1: nest `<a.Boundary>` inside `<b.Boundary>` (sequential), or pull both into a parent `.View` via prop drilling. Adding the combinator later is non-breaking.
- **`keyBy: (loc) => string` escape hatch**: arbitrary user-supplied cache-keying. Defer until a concrete case forces it.
- **Build-time validation that `loader.useData()` is always inside a matching `Boundary`**: nice-to-have lint rule; runtime error message is acceptable for v1.
- **`defineLayout` public helper**: existing route-configuration machinery is sufficient. Add later if ergonomics demand it.
- **Default fallback declared on the loader itself**: blocked by the fact that fallbacks are JSX (client) and `.server.*` files are server-only. Could be supported by moving the default to a sibling client file, but that's two indirections for marginal benefit. Skip.

## Risks and open questions

### Risk: `LoaderRef` from Proxy access vs. server-side reality

The client-side Proxy returns a fresh `LoaderRef` per `serverLoaders.<name>` access. Type inference must be carried by the import; the Proxy stub's TypeScript declaration is `Record<string, LoaderRef<unknown>>` by default, which would lose the per-loader return type.

Mitigation: the build/transform path can emit a `.d.ts` companion describing the container's actual shape (matching `serverActions`'s approach). Implementation plan should verify this works the same way actions does today.

### Risk: nested layouts and multiple `RouteMatchLocationContext` providers

A layout-of-a-layout introduces a chain of locations. The render-time provider chain must install each level's location under its route-manifest-id, and `<Loader>` must read the entry matching its OWN loader's declaring route, skipping intermediate levels. The context-by-id pattern handles this naturally (each provider installs at one key; reads target a specific key), but the implementation must not flatten the chain.

### Risk: SSR streaming + layout loaders during initial render

A layout streaming loader must register with the streaming-SSR registry at the layout level on first paint, then continue flushing as the page-level loaders below it also stream. The existing per-`useId` registry supports many concurrent streams; the open question is ordering / interleaving in the HTML response. The streaming-SSR design (`2026-05-11-streaming-loaders-and-actions-design.md`) is registry-keyed, not page-keyed, so this should "just work," but warrants an integration test.

### Open question: should `default` be the canonical singleton name?

`serverLoaders.default` is fine but slightly awkward (`default` is a JS-reserved-ish word in some contexts). Alternatives considered: `main`, `page`, `data`. None are obviously better. Sticking with `default` for symmetry with default-export conventions and as a clear "this is the unmarked one" signal.

### Open question: how does `invalidate` work across the Proxy?

`serverLoaders.summary.invalidate()` should invalidate the shared cache for that loader. Since the Proxy returns a fresh `LoaderRef` per access, repeated `.summary` accesses must produce refs that share the same `__id` (and thus the same cache map entry). The action stub achieves equivalent behavior; the implementation plan mirrors that pattern.

## Sequencing

This spec lands as a single PR. It is large but coherent; splitting it produces an intermediate state where the framework is inconsistent. The work breakdown lives in the implementation plan; the spec itself is one unit.

Order of v0.1 sequencing impact:

- This spec inserts between v0.1 items 4 and 5 (per `project_v01_sequencing`). It is foundational for the demo polish in item 5 (streaming + Form parity), which will retrofit the movies-demo onto the new API.
- After this lands, the movies-demo PR is rebased to use the new shape; its workaround-justifications in the demo spec are removed.

## Acceptance criteria

- A `.server.*` file can declare any number of loaders inside `serverLoaders`. Each is dispatchable independently over `/__loaders`.
- A page using `.View()` on three loaders renders three independent Suspense boundaries with their respective fallbacks, and each loader streams independently end-to-end (SSR initial paint through client continuation).
- A layout-level loader declared in `layout.server.ts` does not re-fire on inner route navigation. Its streaming subscription survives.
- `loader.useData()` outside a matching `Boundary` throws with a clear, actionable error.
- `params: ['genre']` causes a refetch on `genre` change but not on unrelated search-param changes.
- Existing test fixtures are migrated; the whole test suite (vitest + integration) passes.
- `pnpm -w build` succeeds for the demo apps using the new shape.
