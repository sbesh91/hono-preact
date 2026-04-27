# Direction #3 — Invert Control via Declarative Components

A deep look at replacing `Page`'s monolithic pipeline with a tree of small, declarative components. Each pipeline step becomes a JSX element you can swap, omit, reorder, or wrap. Companion to the direction-#2 doc — same depth, different shape.

## Goals

1. Composability lives in JSX. Adding a new pipeline step (prefetch, retry, error boundary, optimistic overlay) is a new component, not a new prop on `Page`.
2. A convenience `<Page>` exists as a shorthand for the common stack — consumers who need to break out drop down to the granular components.
3. Loader data flows through context, not props. Leaves call `useLoaderData(loaderRef)` and stay decoupled from the pipeline shape.
4. Type safety is preserved by associating a loader's return type with a stable reference (`defineLoader`).
5. SSR hydration, prefetch, optimistic overlays, and `useAction` decoupling all fall out of the new shape — not bolted on.

## Public API surface

```ts
// Components
const Page: <T>(props: PageProps<T>) => JSX.Element              // shorthand
const RouteBoundary: FC<{ fallback?: JSX.Element; children: ComponentChildren }>
const Guards: FC<{ server?: GuardFn[]; client?: GuardFn[]; location: RouteHook; children: ComponentChildren }>
const GuardGate: FC<{ result: GuardResult | null; children: ComponentChildren }>
const Loader: <T>(props: LoaderProps<T>) => JSX.Element
const Envelope: FC<{ as?: ComponentType<WrapperProps> | string; children: ComponentChildren }>
const OptimisticOverlay: <T, A>(props: OverlayProps<T, A>) => JSX.Element

// Hooks
function useLoaderData<T>(ref: LoaderRef<T>): T
function useReload(): ReloadContextValue
function useGuards(guards: GuardFn[], location: RouteHook): GuardResult | null
function useGuardResult(): GuardResult | null

// Utilities
function defineLoader<T>(fn: (ctx: LoaderCtx) => Promise<T>): LoaderRef<T>
function prefetch<T>(ref: LoaderRef<T>, opts?: PrefetchOpts): Promise<T>

// Compat
function getLoaderData<T>(Child: FC<LoaderData<T>>, opts: LegacyOpts): FC  // deprecated shim
```

`LoaderRef<T>` is the linchpin — a typed reference returned by `defineLoader` that ties the loader's return type to its identity. Used by `<Loader>`, `useLoaderData`, and `prefetch`.

## Component by component

### `defineLoader` & `LoaderRef`

```ts
type LoaderCtx = { location: RouteHook }

interface LoaderRef<T> {
  readonly __id: symbol
  readonly fn: (ctx: LoaderCtx) => Promise<T>
  readonly cache?: LoaderCache<T>
}

export function defineLoader<T>(
  fn: (ctx: LoaderCtx) => Promise<T>,
  cache?: LoaderCache<T>,
): LoaderRef<T> {
  return { __id: Symbol('loader'), fn, cache }
}
```

Each loader gets a unique symbol identity. The cache can be bound here (so consumers don't have to pass it everywhere) or supplied later via the `<Loader>` component.

```ts
// Definition lives next to the page module
export const movieLoader = defineLoader<Movie>(
  async ({ location }) => fetchMovie(location.params.id),
  movieCache,
)
```

### `<RouteBoundary>`

Top-level Suspense + (optional) error boundary. Largely a thin wrapper today; carved out so consumers can drop it when their parent already has Suspense.

```tsx
export const RouteBoundary: FC<{
  fallback?: JSX.Element
  children: ComponentChildren
}> = ({ fallback, children }) => (
  <Suspense fallback={fallback}>{children}</Suspense>
)
```

(Future: add an error boundary here as a slot — `errorFallback` prop. Out of scope for the initial design.)

### `<Guards>`

Runs guards via `useGuards`, dispatches via inline `<GuardGate>`. The two-component split exists so a consumer can run guards in one place and dispatch the result somewhere else (e.g., render their own redirect UI).

```tsx
export const Guards: FC<{
  server?: GuardFn[]
  client?: GuardFn[]
  location: RouteHook
  children: ComponentChildren
}> = ({ server = [], client = [], location, children }) => {
  const guards = isBrowser() ? client : server
  const result = useGuards(guards, location)

  return (
    <GuardResultContext.Provider value={result}>
      <GuardGate result={result}>{children}</GuardGate>
    </GuardResultContext.Provider>
  )
}
```

### `<GuardGate>`

The dispatcher. Identical to direction #2's version: redirects on the client, throws `GuardRedirect` on the server, renders the guard's fallback when the result has `render`, otherwise renders children.

### `useGuards` / `useGuardResult`

`useGuards(guards, location)` is the same suspending hook as in direction #2 — runs guards, returns `GuardResult | null`, suspends. `useGuardResult()` is a context read for descendants of `<Guards>` who want to inspect what happened (rare, but possible for analytics or debugging).

### `<Loader>`

The data-fetching boundary. Calls `useLoader` internally, provides `LoaderDataContext` and `ReloadContext` to descendants, suspends until data is ready.

```tsx
type LoaderProps<T> = {
  ref: LoaderRef<T>
  location: RouteHook
  cache?: LoaderCache<T>     // override the ref's bound cache
  fallback?: JSX.Element     // local Suspense fallback
  children: ComponentChildren
}

export function Loader<T>({ ref, location, cache, fallback, children }: LoaderProps<T>) {
  const id = useId()
  const effectiveCache = cache ?? ref.cache

  return (
    <LoaderIdContext.Provider value={id}>
      <Suspense fallback={fallback}>
        <LoaderHost ref={ref} cache={effectiveCache} location={location} id={id}>
          {children}
        </LoaderHost>
      </Suspense>
    </LoaderIdContext.Provider>
  )
}

function LoaderHost<T>({ ref, cache, location, id, children }: LoaderHostProps<T>) {
  const { data, reload, reloading, error } = useLoader(ref.fn, { id, cache, location })

  return (
    <ReloadContext.Provider value={{ reload, reloading, error }}>
      <LoaderDataContext.Provider value={{ refId: ref.__id, data }}>
        {children}
      </LoaderDataContext.Provider>
    </ReloadContext.Provider>
  )
}
```

`LoaderDataContext` keeps a `refId` alongside the data — that's how `useLoaderData(ref)` knows whether the ref it was passed matches what the nearest `<Loader>` is providing. Stacked loaders work because each pushes its own context.

### `useLoaderData`

Typed context read keyed by the loader ref. Walks up the context stack to find the matching loader.

```ts
const LoaderDataContext = createContext<{ refId: symbol; data: unknown } | null>(null)

export function useLoaderData<T>(ref: LoaderRef<T>): T {
  const ctx = useContext(LoaderDataContext)
  if (!ctx) throw new Error('useLoaderData must be called inside a <Loader>')
  if (ctx.refId !== ref.__id) {
    throw new Error(
      'useLoaderData(ref) called with a ref that does not match the nearest <Loader>. ' +
      'If you have nested loaders, the inner ref shadows the outer.'
    )
  }
  return ctx.data as T
}
```

The ref-matching check is conservative — it errors loudly when a consumer passes the "wrong" loader ref. If we want to support nested loaders (a parent loader plus a child loader), we'd need a context registry instead of a single context. Listed in the open questions section.

### `<Envelope>`

The DOM wrapper that carries the SSR-hydrated `data-loader` attribute. Reads `id` and `data` from the surrounding loader context; emits the section/article/whatever element with the right attributes.

```tsx
type EnvelopeProps = {
  as?: ComponentType<WrapperProps> | keyof JSX.IntrinsicElements
  children: ComponentChildren
}

export const Envelope: FC<EnvelopeProps> = ({ as = 'section', children }) => {
  const id = useContext(LoaderIdContext)
  const ctx = useContext(LoaderDataContext)
  if (!id || !ctx) throw new Error('<Envelope> must be inside a <Loader>')

  const dataLoader = isBrowser() ? 'null' : JSON.stringify(ctx.data)

  if (typeof as === 'string') {
    const Tag = as as any
    return <Tag id={id} data-loader={dataLoader}>{children}</Tag>
  }
  const Wrapper = as
  return <Wrapper id={id} data-loader={dataLoader}>{children}</Wrapper>
}
```

`<Envelope>` is optional. If a consumer skips it, hydration falls back to fetch-on-mount (no SSR persistence). This is a real limitation and worth flagging — see open questions for the alternative of a hidden `<script>` tag for data persistence that doesn't require a wrapping element.

### `<OptimisticOverlay>`

Layers a projected view over the base loader data. The new optimistic-UI work fits here cleanly: the overlay is its own component, transparent to leaves, removable.

```tsx
type OverlayProps<T, A> = {
  ref: LoaderRef<T>
  reducer: (base: T, action: A) => T
  pending?: A[]              // queue of in-flight actions
  children: ComponentChildren
}

export function OptimisticOverlay<T, A>({ ref, reducer, pending = [], children }: OverlayProps<T, A>) {
  const ctx = useContext(LoaderDataContext)
  if (!ctx || ctx.refId !== ref.__id)
    throw new Error('<OptimisticOverlay ref={x}> must be inside a <Loader ref={x}>')

  const base = ctx.data as T
  const projected = pending.reduce<T>((acc, action) => reducer(acc, action), base)

  return (
    <LoaderDataContext.Provider value={{ refId: ref.__id, data: projected }}>
      {children}
    </LoaderDataContext.Provider>
  )
}
```

The overlay shadows the loader's data context. Children calling `useLoaderData(ref)` get the projected value transparently. Removing the overlay reverts to base data — clean A/B comparison.

In practice, the `pending` queue would come from a `useOptimistic`-style hook that owns the queue. The overlay component is the projection wrapper.

### `prefetch`

Same shape as direction #2, keyed by `LoaderRef`:

```ts
export async function prefetch<T>(
  ref: LoaderRef<T>,
  opts: { location?: RouteHook; cache?: LoaderCache<T> } = {},
): Promise<T> {
  const fakeLocation = opts.location ?? ({ path: '', query: {} } as RouteHook)
  const cache = opts.cache ?? ref.cache
  const result = await ref.fn({ location: fakeLocation })
  if (isBrowser()) cache?.set(result)
  return result
}
```

```tsx
<Link
  href="/movie/42"
  onMouseEnter={() => prefetch(movieLoader, { location: { path: '/movie/42', query: {} } })}
/>
```

## What `<Page>` becomes

A four-line shorthand for the common stack:

```tsx
type PageProps<T> = {
  loader: LoaderRef<T>
  location: RouteHook
  cache?: LoaderCache<T>
  serverGuards?: GuardFn[]
  clientGuards?: GuardFn[]
  fallback?: JSX.Element
  Wrapper?: ComponentType<WrapperProps>
  children: ComponentChildren
}

export function Page<T>({
  loader, location, cache, serverGuards, clientGuards, fallback, Wrapper, children,
}: PageProps<T>) {
  return (
    <RouteBoundary fallback={fallback}>
      <Guards server={serverGuards} client={clientGuards} location={location}>
        <Loader ref={loader} location={location} cache={cache} fallback={fallback}>
          <Envelope as={Wrapper}>
            {children}
          </Envelope>
        </Loader>
      </Guards>
    </RouteBoundary>
  )
}
```

The shorthand collapses to a one-liner at call sites:

```tsx
export default ({ location }) => (
  <Page loader={movieLoader} location={location}>
    <MovieDetail />
  </Page>
)
```

## Consumer migration

Every page in `apps/app/` changes shape. The mechanical transformation:

```tsx
// === Before ===
function MovieDetail({ loaderData }: LoaderData<Movie>) {
  return <h1>{loaderData.title}</h1>
}
export default getLoaderData(MovieDetail, {
  serverLoader: movieLoader,
  cache: movieCache,
  serverGuards,
  clientGuards,
})

// === After ===
const movieLoaderRef = defineLoader<Movie>(movieLoader, movieCache)

function MovieDetail() {
  const movie = useLoaderData(movieLoaderRef)
  return <h1>{movie.title}</h1>
}

export default ({ location }) => (
  <Page
    loader={movieLoaderRef}
    location={location}
    serverGuards={serverGuards}
    clientGuards={clientGuards}
  >
    <MovieDetail />
  </Page>
)
```

Three diffs per page:

1. Wrap loader in `defineLoader(...)` (often one-line).
2. Replace `loaderData` prop destructuring with a `useLoaderData(ref)` call.
3. Replace `getLoaderData(Child, opts)` HOC with a JSX `<Page>` wrapper.

In practice, both could coexist: `getLoaderData` stays as a deprecated compat shim that internally renders `<Page>`. Migration becomes opt-in, page-by-page:

```tsx
// Compat shim
export function getLoaderData<T>(Child, opts): FC {
  const ref = defineLoader(opts.serverLoader ?? (async () => ({})), opts.cache)
  return ({ location }) => (
    <Page loader={ref} location={location} {...opts}>
      <ChildWrapper Child={Child} ref={ref} />
    </Page>
  )
}

function ChildWrapper<T>({ Child, ref }) {
  const data = useLoaderData(ref)
  const id = useContext(LoaderIdContext)
  return <Child loaderData={data} id={id} />
}
```

This means existing pages keep working without changes; the migration is gradual.

## How `useAction` decouples from `Page`

`useAction` today reads `ReloadContext`. Under direction #3, `ReloadContext` is provided by `<Loader>` (not `<Page>`) — so `useAction` works in any `<Loader>`-rooted subtree, including loaders nested inside other layouts. That's already an improvement.

To work fully outside any `<Loader>`, we add the same explicit `cache` / `reload` options as direction #2:

```ts
export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | string[]
  cache?: LoaderCache<unknown>     // explicit
  reload?: () => void              // explicit
  // ... existing options
}
```

`auto` falls back to `ReloadContext` when neither is provided. Backwards compatible.

## Consumer scenarios

### 1. Default page

```tsx
export default ({ location }) => (
  <Page loader={movieLoader} location={location}>
    <MovieDetail />
  </Page>
)
```

### 2. Different fallbacks for guards vs loader

```tsx
export default ({ location }) => (
  <RouteBoundary fallback={<GuardSpinner />}>
    <Guards server={serverGuards} client={clientGuards} location={location}>
      <Suspense fallback={<DataSpinner />}>
        <Loader ref={movieLoader} location={location}>
          <Envelope>
            <MovieDetail />
          </Envelope>
        </Loader>
      </Suspense>
    </Guards>
  </RouteBoundary>
)
```

The two `<Suspense>` boundaries each get their own fallback. Today this requires writing a custom `Page`.

### 3. Optimistic overlay

```tsx
function MoviePage({ pendingActions }) {
  return (
    <Loader ref={movieLoader} location={location}>
      <OptimisticOverlay ref={movieLoader} reducer={watchedReducer} pending={pendingActions}>
        <Envelope>
          <MovieDetail />
        </Envelope>
      </OptimisticOverlay>
    </Loader>
  )
}

function MovieDetail() {
  const movie = useLoaderData(movieLoader)  // gets projected data transparently
  // ...
}
```

The leaf doesn't know about optimism. Adding/removing the overlay is a single JSX edit.

### 4. Hover prefetch

```tsx
<a
  href="/movie/42"
  onMouseEnter={() => prefetch(movieLoader, { location: { path: '/movie/42' } })}
>
  Watch
</a>
```

### 5. Standalone mutation modal — no loader needed

```tsx
function FeedbackModal() {
  const { mutate, pending } = useAction(serverActions.submitFeedback, {
    invalidate: 'auto',
    cache: feedbackCache,
  })
  return <Form onSubmit={mutate} disabled={pending} />
}
```

### 6. Multi-loader page (nested)

A profile page that loads user data at the top and post data deeper:

```tsx
<Page loader={userLoader} location={location}>
  <ProfileHeader />
  <Loader ref={postsLoader} location={location} fallback={<PostsSpinner />}>
    <PostList />
  </Loader>
</Page>

function ProfileHeader() {
  const user = useLoaderData(userLoader)
  return <h1>{user.name}</h1>
}

function PostList() {
  const posts = useLoaderData(postsLoader)
  return posts.map(p => <Post key={p.id} post={p} />)
}
```

Two loaders, two refs, two `useLoaderData` reads — each typed correctly.

### 7. Custom error UI

```tsx
function MoviePage({ location }) {
  return (
    <Guards server={serverGuards} client={clientGuards} location={location}>
      <ErrorBoundary fallback={(err) => <CustomError error={err} />}>
        <Loader ref={movieLoader} location={location}>
          <Envelope>
            <MovieDetail />
          </Envelope>
        </Loader>
      </ErrorBoundary>
    </Guards>
  )
}
```

`ErrorBoundary` is something the consumer brings (or we ship one). The point: it slots into the tree wherever desired.

## File structure

Flat in `packages/iso/src/`:

```
src/
  page.tsx                    # <Page> shorthand (~30 lines)
  route-boundary.tsx          # <RouteBoundary> (~10 lines)
  guards.tsx                  # <Guards> (~25 lines)
  guard-gate.tsx              # <GuardGate> (~25 lines)
  loader.tsx                  # <Loader>, <LoaderHost> (~50 lines)
  envelope.tsx                # <Envelope> (~30 lines)
  optimistic-overlay.tsx      # <OptimisticOverlay> (~30 lines)
  define-loader.ts            # defineLoader, LoaderRef type (~20 lines)
  use-loader.ts               # internal useLoader hook (shared with #2; ~80 lines)
  use-loader-data.ts          # useLoaderData(ref) (~25 lines)
  use-guards.ts               # useGuards, useGuardResult (~40 lines)
  use-reload.ts               # useReload, ReloadContext (~25 lines)
  prefetch.ts                 # prefetch utility (~15 lines)
  loader-contexts.ts          # LoaderIdContext, LoaderDataContext, GuardResultContext
  legacy-get-loader-data.tsx  # compat shim for old getLoaderData HOC (~40 lines)
  ...existing (cache, guard, preload, action, form, wrap-promise, is-browser)
```

`page.tsx` shrinks from ~250 lines to ~30. ~10 new files of ~25 lines each. Net code is roughly +200 lines (similar to #2) — but distributed across many small focused units.

## Migration plan

This is the big difference from #2. Direction #3 ships in stages, with consumer migration spread across several PRs.

**PR 1 — Infrastructure (no breakage).**
Add `defineLoader`, `LoaderRef`, `useLoaderData(ref)`, `LoaderDataContext`, `LoaderIdContext`. Add `<Loader>`, `<Guards>`, `<GuardGate>`, `<RouteBoundary>`, `<Envelope>` as new exports. Existing `Page` keeps working. Both APIs coexist.

**PR 2 — `Page` becomes the shorthand.**
Reimplement existing `Page` as the four-line composition over the new components. Existing prop signature preserved. `getLoaderData` HOC continues to work (now internally renders the new `<Page>`). All existing pages keep working unchanged. This is the same shape change as #2's PR but with more new components in place.

**PR 3 — `useAction` decoupling.**
Add `cache` and `reload` options. ReloadContext fallback retained. Same as direction #2.

**PR 4 — `prefetch` and `<OptimisticOverlay>`.**
Public exports. Documentation page.

**PR 5 — First consumer migration.**
Migrate one page (e.g., `apps/app/src/pages/movie.tsx`) to the new shape: `defineLoader`, `useLoaderData(ref)`, JSX `<Page>` wrapper. Validates ergonomics; documents the pattern.

**PR 6+ — Gradual migration.**
Move pages one (or a few) at a time. `getLoaderData` shim stays indefinitely.

**Eventually — Deprecate `getLoaderData`.**
After all consumers migrate, deprecate the shim. Final removal is a major-version bump.

## Risks & open questions

1. **`useId` stability when components are inserted between `<Page>` and `<Loader>`.** Today `useId()` lives on `Page`. Under #3, it lives on `<Loader>`. SSR-rendered `useId` and client-side `useId` must produce the same string for hydration. Adding a `<RouteBoundary>` and `<Guards>` parent shouldn't perturb this (the id is determined by fiber position relative to the root), but it's exactly the kind of subtle thing that breaks SSR. Needs an integration test that loads a page server-side and verifies `getPreloadedData(id)` finds the data on hydrate.

2. **`<Envelope>` is required for SSR data persistence.** If a consumer composes `<Loader>` without `<Envelope>`, the server has nowhere to write `data-loader`, and the client will refetch. This is a real footgun. **Alternative**: persist SSR data via a hidden `<script type="application/json" data-loader-id={id}>...</script>` element rendered by `<Loader>` itself. Then `<Envelope>` becomes purely about DOM structure and SSR persistence works regardless. Slightly larger DOM payload; cleaner architecture. Worth deciding before shipping.

3. **`useLoaderData(ref)` ref-mismatch errors.** Today, the leaf component receives `loaderData` as a prop that's typed `LoaderData<T>`. There's no possibility of "wrong loader" — there's only one. Under #3, a consumer could pass the wrong ref to `useLoaderData` (e.g., `useLoaderData(otherLoader)` inside a `<Loader ref={movieLoader}>`), and the runtime check would error. This is recoverable but it's a runtime failure where today it would be a compile error. Mitigation: a TypeScript helper that verifies the ref matches the surrounding loader at build time? Probably out of scope; document the constraint.

4. **Nested loader contexts.** The `LoaderDataContext` stores one `{refId, data}` pair. If a child component nests another `<Loader ref={postsLoader}>` inside a `<Loader ref={userLoader}>`, the inner context shadows the outer — `useLoaderData(userLoader)` from inside the posts loader would error. Two options: (a) document that nested loaders shadow, and consumers must pass user data via props or a separate context; or (b) make `LoaderDataContext` a stack, indexed by `refId`, so multiple loaders can be read independently from descendants. (b) is cleaner but adds state-management complexity. Worth deciding.

5. **`useId` vs `useId()` collision when overlay is added.** `<OptimisticOverlay>` doesn't call `useId`, so this is fine. But if future components do (e.g., a `<RetryBoundary>`), they need to be careful not to disturb the `<Loader>`'s id. Convention: only `<Loader>` calls `useId` for SSR purposes; everything else uses local refs.

6. **TypeScript error messages on `useLoaderData(wrongRef)`.** With a generic `LoaderRef<T>`, TS will type the return as `T`, but it can't catch passing the wrong ref to the wrong context. The runtime error in §3 is the safety net. We could do better with a phantom-typed context, but it's a lot of generics gymnastics for a relatively rare bug.

7. **`prefetch` with location-dependent loaders.** Today, the loader receives `{ location }` from the route hook. Prefetching at hover time means we don't have a real `RouteHook` — we have to fabricate one from a target URL. The `location` in the fake hook needs to provide whatever the loader reads (path, query, params). Underspecified today; should formalize a `LoaderCtx` type that's narrower than the full `RouteHook`.

8. **`<Form>` and the optimistic plan.** The plan refactors `<Form>` to accept `{ mutate, pending }`. That's compatible with both directions. Under #3, `<Form>` doesn't read loader data — it just submits — so no integration to design here. Stays as drafted.

9. **Bundle size.** Splitting one component into ten increases the count of distinct module imports, but tree-shakable and the per-component code is smaller. Net wash, probably slightly favorable.

## What this does *not* solve

- **Type-safe leaf data without the runtime ref check.** A truly type-safe version would require either generic context (TS supports this awkwardly) or codegen. We accept the runtime check as the safety net.
- **Implicit pipeline ordering.** `<Page>` still bakes in guards-then-loader. Consumers who want "loader-then-guards" (rare, but conceivable for pages where data informs guard decisions) compose their own. The shorthand has an opinion; consumers can override.
- **Built-in error rendering on `<Page>`.** Same as #2 — the *primitive* exists (`error` from `useLoader`), but `<Page>` doesn't render an error UI. Consumers wrap their own `<ErrorBoundary>`, or we add an `errorFallback` prop to `<Page>` later.

## Comparison with direction #2

The two directions share a lot of internals: `useLoader`, `useGuards`, the lazy fetch promise, the `useAction` decoupling, `prefetch`. The differences are at the surface:

| | #2 Hooks | #3 Components |
|---|---|---|
| Consumer interface | `Page` props (unchanged) | `<Page>` shorthand or granular components |
| Pipeline composition | Implicit inside `Page` | Explicit JSX nesting |
| Data flow to leaf | `loaderData` prop | `useLoaderData(ref)` context |
| Type safety | Compile-time prop type | Runtime ref check + TS generic |
| Migration cost | Zero for consumers | Per-page refactor (gradual via shim) |
| Adding a pipeline step | New hook + recompose `Page` | Drop in a new component |
| Optimistic overlay | Hook-based, in leaf | Component-based, in tree |
| Suspense boundary control | Bake into `Page` or break out | First-class component |
| Multi-loader pages | Possible, no built-in primitive | Native: nest `<Loader>`s |

The decision factors:

- **If migration cost is a concern** → #2.
- **If future feature additions are mostly new pipeline steps** (retry, error UI, prefetch boundaries, request timing, request deduplication) → #3 wins because each is a new component, not a new prop on a growing `Page`.
- **If multi-loader pages are likely** → #3 supports them natively; #2 requires manual hook composition.
- **If type safety on leaf data matters more than composability** → #2.

## Bottom line

Direction #3 is a redesign, not a refactor. It ships incrementally — new components alongside the old API, then a per-page migration that can stretch over many PRs. The end state is a vocabulary of small components that compose freely in JSX, where every plausible "I wish the pipeline did X" becomes a new component or a tree edit.

The cost is real: every consumer page eventually changes, and `useLoaderData(ref)` introduces a runtime check that doesn't exist today. The benefit is that the iso package stops being a single monolithic abstraction and becomes a kit of primitives that can be assembled for novel cases without forking. The optimistic-UI work is the first feature this would actually unlock cleanly — and there will be a second, and a third.
