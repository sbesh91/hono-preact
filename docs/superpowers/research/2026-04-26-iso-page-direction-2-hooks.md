# Direction #2 — Decompose `Page` into Hooks

A deep look at how the iso `Page` monolith would be split into composable hooks while keeping the public `Page` API stable. This document is exploratory — it shows what the implementation would actually look like, not a final spec.

## Goals

1. Each responsibility currently mixed inside `Page` / `GuardedPage` becomes its own hook with a single clear job.
2. The default `Page` component continues to work, with identical props and behavior — it becomes a thin composition over the new hooks.
3. Consumers who need to break out of the default pipeline (skip cache, skip guards, render their own error UI, prefetch on hover, etc.) call hooks directly — no forking.
4. `useAction` no longer hard-depends on being inside a `Page` tree.

## Public API surface

```ts
// Hooks (new)
function useGuards(guards: GuardFn[], location: RouteHook): GuardResult | null
function useLoader<T>(loader: Loader<T>, opts: UseLoaderOptions<T>): UseLoaderResult<T>
function useLoaderData<T>(): T                       // context read, for advanced cases
function useReload(): ReloadContextValue              // unchanged

// Utility (new)
function prefetch<T>(loader: Loader<T>, cache?: LoaderCache<T>, location?: RouteHook): Promise<T>

// Components (unchanged signatures)
const Page: <T>(props: PageProps<T>) => JSX.Element
function getLoaderData<T>(Child, opts): FunctionComponent

// Components (new, but exported for advanced use)
const GuardGate: FunctionComponent<{ result: GuardResult | null; children: ComponentChildren }>
```

`UseLoaderOptions` and `UseLoaderResult`:

```ts
type UseLoaderOptions<T> = {
  id: string                      // for SSR preload lookup
  cache?: LoaderCache<T>
  location: RouteHook
}

type UseLoaderResult<T> = {
  data: T                         // suspends until ready
  reload: () => void
  reloading: boolean
  error: Error | null
}
```

## Hook by hook

### `useGuards`

Suspends until guards resolve. Re-runs when `location.path` changes. Returns the raw `GuardResult` — does not dispatch redirects or render fallbacks (that's `<GuardGate>`'s job).

```ts
export function useGuards(
  guards: GuardFn[],
  location: RouteHook,
): GuardResult | null {
  const prevPath = useRef(location.path)
  const guardRef = useRef<{ read: () => GuardResult | null }>()

  if (!guardRef.current || prevPath.current !== location.path) {
    prevPath.current = location.path
    guardRef.current = wrapPromise(runGuards(guards, { location }))
  }

  return guardRef.current.read()
}
```

Direct port of the guard logic from `page.tsx:71-76`. Suspends via `wrapPromise.read()`.

### `<GuardGate>`

The dispatcher: takes a `GuardResult` and either renders children, redirects, or renders the guard's fallback component. Pulled out so consumers can choose to dispatch differently (e.g., render their own redirect UI).

```tsx
export const GuardGate: FunctionComponent<{
  result: GuardResult | null
  children: ComponentChildren
}> = ({ result, children }) => {
  const { route } = useLocation()

  if (result && 'redirect' in result) {
    if (isBrowser()) {
      route(result.redirect)
      return null
    }
    throw new GuardRedirect(result.redirect)
  }

  if (result && 'render' in result) {
    const Fallback = result.render
    return <Fallback />
  }

  return <>{children}</>
}
```

Direct port of `page.tsx:150-162`.

### `useLoader`

The big one. Combines preload check, cache check, fetch, and reload state machine. Returns `data` (suspends) plus reload utilities.

```ts
export function useLoader<T>(
  loader: Loader<T>,
  { id, cache, location }: UseLoaderOptions<T>,
): UseLoaderResult<T> {
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [override, setOverride] = useState<T | undefined>(undefined)

  // Reset override on path change
  const prevPath = useRef(location.path)
  if (prevPath.current !== location.path) {
    prevPath.current = location.path
    setOverride(undefined)
  }

  // Stable refs for reload
  const loaderRef = useRef(loader); loaderRef.current = loader
  const locationRef = useRef(location); locationRef.current = location

  const reload = useCallback(() => {
    if (reloading) return
    setReloading(true)
    setError(null)
    loaderRef.current({ location: locationRef.current })
      .then((result) => {
        if (isBrowser()) cache?.set(result)
        setOverride(result)
        setReloading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setReloading(false)
      })
  }, [reloading, cache])

  // Read path: override > preload > cache > fetch
  const data = readLoaderData(loader, { id, cache, location, override })

  return { data, reload, reloading, error }
}

// Internal — handles the read priority chain
function readLoaderData<T>(
  loader: Loader<T>,
  { id, cache, location, override }: UseLoaderOptions<T> & { override?: T },
): T {
  if (override !== undefined) return override

  const preloaded = getPreloadedData<T>(id)
  if (preloaded !== null) {
    if (isBrowser()) cache?.set(preloaded)
    return preloaded
  }

  if (isBrowser() && cache?.has()) {
    return cache.get()!
  }

  // Suspend on fetch — memoized so re-renders during suspense don't refetch
  const promiseRef = useFetchPromise(loader, location, cache)
  return promiseRef.read()
}

function useFetchPromise<T>(
  loader: Loader<T>,
  location: RouteHook,
  cache?: LoaderCache<T>,
): { read: () => T } {
  const ref = useRef<{ read: () => T } | null>(null)
  const prevPath = useRef<string | null>(null)

  if (ref.current === null || prevPath.current !== location.path) {
    prevPath.current = location.path
    ref.current = wrapPromise(
      loader({ location }).then((r) => {
        if (isBrowser()) cache?.set(r)
        return r
      })
    )
  }

  return ref.current
}
```

Notes on what changed from today:

- **Refetch on path change.** Today (page.tsx:196-201) the fetch promise is created on every render. It works because Suspense pauses re-renders, but it would refetch on a real re-render after path change. The new `useFetchPromise` only re-creates the promise when `location.path` actually changes. Behaviorally equivalent for the common case; safer for edge cases.
- **`override` lives next to the data path.** The state owns "did the user reload?" and the read function honors it. Same outcome as today, but co-located with the read instead of split between `GuardedPage` (state) and `Helper` (read).
- **Hooks-of-hooks.** `readLoaderData` calls `useFetchPromise` only on the fetch branch. This is a conditional hook call — **not OK in React**. Real implementation must hoist `useFetchPromise` to the top level and only `read()` it on the fetch branch:

```ts
export function useLoader<T>(loader, { id, cache, location }): UseLoaderResult<T> {
  // ... state ...
  const fetchPromise = useFetchPromise(loader, location, cache)  // always called

  const data = (() => {
    if (override !== undefined) return override
    const preloaded = getPreloadedData<T>(id)
    if (preloaded !== null) { if (isBrowser()) cache?.set(preloaded); return preloaded }
    if (isBrowser() && cache?.has()) return cache.get()!
    return fetchPromise.read()  // suspends here
  })()

  return { data, reload, reloading, error }
}
```

Cost: we always *prepare* the fetch promise (call `wrapPromise(loader({location}))`), even when we end up returning preloaded or cached data. The `loader({location})` call itself is eager. To avoid that, the promise must be lazy:

```ts
function useFetchPromise<T>(loader, location, cache) {
  const ref = useRef<{ read: () => T; lazy: () => void } | null>(null)
  const prevPath = useRef<string | null>(null)

  if (ref.current === null || prevPath.current !== location.path) {
    prevPath.current = location.path
    let started: { read: () => T } | null = null
    ref.current = {
      lazy: () => { /* no-op — only triggers when read() called */ },
      read: () => {
        if (!started) {
          started = wrapPromise(
            loader({ location }).then((r) => {
              if (isBrowser()) cache?.set(r)
              return r
            })
          )
        }
        return started.read()
      },
    }
  }
  return ref.current
}
```

This makes the fetch lazy: it only fires when `read()` is called. Cleaner than the alternative.

### `useLoaderData` (context read)

For consumers who want to read loader data deep in the tree without prop-drilling. Currently the leaf component receives `loaderData` via prop. We keep that — but also expose a context read for the cases where it's awkward to prop-drill.

```ts
const LoaderDataContext = createContext<unknown>(null)

export function useLoaderData<T>(): T {
  const data = useContext(LoaderDataContext)
  if (data === null) throw new Error('useLoaderData must be called inside a Page')
  return data as T
}
```

Provided by `Page`'s internal composition. Optional for consumers — they can keep using the `loaderData` prop. This is a non-breaking addition.

### `prefetch`

Imperative utility for hover-prefetch and similar patterns. Same fetch + cache code path as `useLoader`, but callable from anywhere.

```ts
export async function prefetch<T>(
  loader: Loader<T>,
  cache?: LoaderCache<T>,
  location?: RouteHook,
): Promise<T> {
  const fakeLocation = location ?? { path: '', query: {}, route: () => {} } as RouteHook
  const result = await loader({ location: fakeLocation })
  if (isBrowser()) cache?.set(result)
  return result
}
```

Usage:

```tsx
<a
  href="/movie/42"
  onMouseEnter={() => prefetch(movieLoader, movieCache, { path: '/movie/42' })}
>
  Watch
</a>
```

`location` is optional because some loaders don't depend on it.

## What `Page` becomes

```tsx
export const Page = memo(function <T extends Record<string, unknown>>({
  Child,
  serverLoader = async () => ({}) as T,
  location,
  cache,
  serverGuards = [],
  clientGuards = [],
  fallback,
  Wrapper,
}: PageProps<T>) {
  const id = useId()
  const guards = isBrowser() ? clientGuards : serverGuards

  return (
    <Suspense fallback={fallback}>
      <PageBody
        id={id}
        Child={Child}
        loader={serverLoader}
        location={location}
        cache={cache}
        guards={guards}
        fallback={fallback}
        Wrapper={Wrapper}
      />
    </Suspense>
  )
})

const PageBody = memo(function <T>({ id, Child, loader, location, cache, guards, fallback, Wrapper }: PageBodyProps<T>) {
  const guardResult = useGuards(guards, location)

  return (
    <GuardGate result={guardResult}>
      <Suspense fallback={fallback}>
        <LoaderHost
          id={id}
          loader={loader}
          location={location}
          cache={cache}
          Child={Child}
          Wrapper={Wrapper}
        />
      </Suspense>
    </GuardGate>
  )
})

const LoaderHost = memo(function <T>({ id, loader, location, cache, Child, Wrapper }: LoaderHostProps<T>) {
  const { data, reload, reloading, error } = useLoader(loader, { id, cache, location })

  return (
    <ReloadContext.Provider value={{ reload, reloading, error }}>
      <LoaderDataContext.Provider value={data}>
        <Helper id={id} Child={Child} data={data} Wrapper={Wrapper} />
      </LoaderDataContext.Provider>
    </ReloadContext.Provider>
  )
})
```

Three small components, each calling exactly one hook. `Page` (~30 lines) → `PageBody` (~15 lines) → `LoaderHost` (~15 lines) → `Helper` (unchanged).

The two-Suspense structure is preserved: outer for guards, inner for loader. Distinct fallback experiences for each phase, same as today.

## How `useAction` decouples from `Page`

Today (action.ts:47):

```ts
const reloadCtx = useContext(ReloadContext)
// ...
if (currentOptions?.invalidate === 'auto') {
  reloadCtx?.reload()
}
```

`reloadCtx` is `undefined` outside a `Page`, so `auto` becomes a silent no-op. That's the friction point.

After:

```ts
export type UseActionOptions<TPayload, TResult, TSnapshot = unknown> = {
  invalidate?: 'auto' | false | string[]
  cache?: LoaderCache<unknown>     // NEW: explicit cache to invalidate
  reload?: () => void               // NEW: explicit reload (overrides ReloadContext)
  onMutate?: ...
  onError?: ...
  onSuccess?: ...
  onChunk?: ...
}

export function useAction(stub, options) {
  const reloadCtx = useContext(ReloadContext)  // still consulted as fallback
  // ...
  if (currentOptions?.invalidate === 'auto') {
    const reload = currentOptions.reload ?? reloadCtx?.reload
    const cache = currentOptions.cache
    if (reload) reload()
    else if (cache) cache.invalidate()
    // else: silent no-op (same as today's behavior outside Page)
  }
}
```

In a `Page`, existing usage works unchanged. Outside a `Page`, consumers pass `cache` or `reload` explicitly. Backwards compatible.

## Consumer scenarios

### 1. Default page (95% of usage) — no change

```tsx
export default getLoaderData(MovieDetail, {
  serverLoader: movieLoader,
  cache: movieCache,
})
```

### 2. Guards-only page — no loader needed

```tsx
function PreviewPage({ location }) {
  const guards = isBrowser() ? [authGuard] : [authGuard]
  const result = useGuards(guards, location)
  return (
    <GuardGate result={result}>
      <PreviewUI />
    </GuardGate>
  )
}
```

### 3. Custom error UI — bypass Suspense fallback

```tsx
function MutationPage({ location }) {
  const id = useId()
  const { data, reload, error } = useLoader(myLoader, { id, location, cache: myCache })

  if (error) return <CustomErrorUI error={error} onRetry={reload} />
  return <Form data={data} />
}
```

(Note: the loader still suspends on first fetch — wrap in `<Suspense>` outside.)

### 4. Hover prefetch

```tsx
<Link
  href="/movie/42"
  onMouseEnter={() => prefetch(movieLoader, movieCache, location)}
>
  Watch
</Link>
```

### 5. Standalone mutation modal — `useAction` outside a Page

```tsx
function FeedbackModal() {
  const { mutate, pending } = useAction(serverActions.submitFeedback, {
    invalidate: 'auto',
    cache: feedbackCache,  // explicit, since no ReloadContext
  })
  return <Form onSubmit={mutate} disabled={pending} />
}
```

### 6. Optimistic UI integration

`useOptimisticAction` (per the unstaged plan) wraps `useAction`. With the decoupled `useAction`, the optimistic hook works identically inside or outside a `Page`. The optimistic projection state lives in the consumer component, the `data` source is either `loaderData` prop (default) or `useLoaderData()` (context). Either flow works.

## File structure

Flat, in `packages/iso/src/`:

```
src/
  page.tsx              # Page component + LoaderHost + LoaderDataContext provider
  page-body.tsx         # PageBody (the inside-Suspense composition)
  use-guards.ts         # useGuards
  use-loader.ts         # useLoader, useFetchPromise, readLoaderData helpers
  use-loader-data.ts    # useLoaderData (context read)
  guard-gate.tsx        # <GuardGate>
  prefetch.ts           # prefetch utility
  reload-context.ts     # ReloadContext + useReload (extracted)
  loader-data-context.ts # LoaderDataContext (internal export)
  loader.tsx            # getLoaderData HOC (unchanged)
  ...existing files (cache, guard, preload, action, form, etc.)
```

`page.tsx` shrinks from ~250 lines to ~50. The new files are 20–60 lines each.

## Migration plan

Single-PR migration is feasible because the public API doesn't change.

**Step 1 — Extract pure functions.** Pull `wrapPromise`, `getPreloadedData`, `runGuards` calls into the new hook files. No behavior change.

**Step 2 — Add `useGuards` and `<GuardGate>`.** Wire `Page` to call them internally. Verify guard tests pass.

**Step 3 — Add `useLoader`.** Wire `Page` to call it via `LoaderHost`. Verify loader tests pass. Verify SSR hydration still works (the `useId` → `getPreloadedData` round-trip is sensitive).

**Step 4 — Decouple `useAction` from `ReloadContext`.** Add the optional `cache` and `reload` options. Keep `ReloadContext` consultation as fallback. Existing tests pass.

**Step 5 — Add `prefetch`, `useLoaderData`, `<GuardGate>` to public exports.** Update `index.ts`.

**Step 6 — Document the new primitives** in `docs/iso-package/`.

No consumer code in `apps/app/` changes in any step.

## Risks & open questions

1. **Lazy fetch promise correctness.** The lazy-fetch implementation must guarantee that suspending mid-render doesn't cause the loader to fire twice (once on the suspended render, once on resume). The `started` flag inside the ref protects against this — needs a test that exercises the path.
2. **`useId` stability across the new component layers.** `useId` lives on `Page`; `LoaderHost` reads it from props. SSR hydration matches `useId` between server and client — adding intermediate components must not perturb the id sequence. Should hold because `useId` uses fiber position, not call order, but worth a sanity test.
3. **`useFetchPromise` and concurrent mode.** With Preact's compat Suspense, throwing in a deeply nested component should still bubble to the outer boundary. Verify the new `LoaderHost` boundary placement doesn't accidentally catch the wrong promise.
4. **Naming overlap.** "useLoaderData" is also React Router's hook name — recognizable but may cause confusion if the project ever mixes routers. Worth checking the precedent in the codebase before locking the name.
5. **`useReload` outside a `LoaderHost`.** Today `useReload` throws if there's no provider. This stays the same — `useReload` is a context read, period. Consumers using `useLoader` directly get reload from the hook return value, not from `useReload()`.
6. **What if a consumer wants no Suspense around the loader?** They'd call `useLoader` directly, but the fetch path still throws a promise. They need to provide their own boundary. This is consistent with React's model — flag in docs.

## What this does *not* solve

- **Pipeline ordering is still fixed inside `Page`** (guard → preload → cache → fetch). Consumers who want a different order have to write their own composition, not just pass props. Direction #3 is what would solve this for the convenience component too.
- **Children still receive `loaderData` as a prop by default.** `useLoaderData()` is additive; it doesn't replace the existing prop interface. If you want context-only data flow throughout, that's direction #3.
- **Error rendering still requires wrapping in an error boundary.** This direction adds the *primitive* (`error` from `useLoader`) but not a built-in error UI slot on `Page`. That could be added incrementally as a `Page` prop (`errorFallback`) without rethinking the architecture.

## Bottom line

Direction #2 is a refactor, not a redesign. It preserves every public API, swaps the monolithic `Page` for a thin composition over four hooks, and gives consumers escape hatches without rewriting any pages. The optimistic-UI work fits naturally on top because `useAction` becomes context-independent.

The cost is roughly 200 net lines of code spread across six small files, and a few sensitive areas (lazy fetch, `useId` stability) that need tests. The benefit is that every plausible "I wish I could…" scenario from the first research doc — prefetch, custom error UI, guards-without-loader, mutation-without-Page — becomes one or two lines of consumer code.
