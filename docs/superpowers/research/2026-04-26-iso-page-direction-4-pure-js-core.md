# Direction #4 — Pure-JS Core with Framework Adapters

A deep look at relocating most of iso's logic out of Preact-coupled components and into a framework-agnostic JS core. Companion to the direction-#2 and #3 docs — same depth, more ambitious in scope.

## Goals

1. Loader execution, guard pipelines, cache logic, action dispatch, SSR serialization, and prefetch all live in plain JS — no React/Preact imports.
2. A small reactive store at the bottom; framework adapters on top observe it.
3. Iso can run outside the render tree: in Hono middleware, in a Worker, in tests, in a future React adapter.
4. SSR hydration becomes deterministic via loader names, not `useId`.
5. Existing optimistic-UI plan continues to fit naturally.

## Architectural shape

```
@hono-preact/iso-core            (no framework deps)
├─ define-loader.ts              defineLoader(name, fn) → LoaderRef
├─ define-guard.ts               defineGuard(name, fn) → GuardRef
├─ define-page.ts                definePage(opts) → PageDescriptor
├─ store.ts                      tiny pub/sub primitive
├─ page-controller.ts            orchestrates guards + loaders for a page
├─ loader-state.ts               per-loader state machine
├─ action-dispatch.ts            fetch+stream logic (lifted from useAction)
├─ preload.ts                    reads SSR-injected data
├─ ssr-serialize.ts              writes SSR data
├─ cache.ts                      (existing — already pure JS)
├─ cache-registry.ts             (existing — already pure JS)
└─ guards.ts                     runGuards (existing — already pure JS)

@hono-preact/iso-preact          (~150 lines total)
├─ use-page.ts                   useSyncExternalStore over PageController
├─ use-loader-data.ts            typed read against the page state
├─ use-action.ts                 adapter over action-dispatch
├─ use-reload.ts                 adapter
├─ page.tsx                      <Page> — observer + context provider
├─ loader.tsx                    <Loader> — sub-page composition
├─ envelope.tsx                  <Envelope> — SSR DOM wrapper
├─ guard-gate.tsx                <GuardGate>
└─ index.ts
```

The split is intentional: every line of code that doesn't *need* JSX/hooks gets pulled into the core. The adapter is the thinnest layer that satisfies "make Preact components observe the core."

## Public API surface

### Core (framework-agnostic)

```ts
// Loader & guard definitions
function defineLoader<T>(name: string, fn: (ctx: LoaderCtx) => Promise<T>, opts?: { cache?: LoaderCache<T> }): LoaderRef<T>
function defineGuard(name: string, fn: GuardFn): GuardRef

// Page composition
function definePage<T>(opts: {
  name: string
  loader?: LoaderRef<T>
  serverGuards?: GuardRef[]
  clientGuards?: GuardRef[]
  cache?: LoaderCache<T>
}): PageDescriptor<T>

// Page lifecycle
function mountPage<T>(descriptor: PageDescriptor<T>, ctx: { location: RouteHook }): PageController<T>

// Imperative ops
function prefetch<T>(loader: LoaderRef<T>, ctx?: { location?: RouteHook }): Promise<T>
function reload<T>(loader: LoaderRef<T>): Promise<T>
function invalidate(loader: LoaderRef<unknown>): void

// SSR
function renderPage<T>(descriptor: PageDescriptor<T>, ctx: { location: RouteHook }): Promise<{
  state: PageState<T>
  serializedData: Record<string, string>     // keyed by loader name
}>
function hydratePage<T>(descriptor: PageDescriptor<T>, preloaded: Record<string, unknown>): void

// Action dispatch
function dispatchAction<TPayload, TResult>(
  stub: ActionStub<TPayload, TResult>,
  payload: TPayload,
  hooks?: ActionHooks<TPayload, TResult>,
): Promise<TResult>

// Types
type PageState<T> =
  | { phase: 'idle' }
  | { phase: 'guards-running' }
  | { phase: 'guard-result'; result: GuardResult }
  | { phase: 'loading' }
  | { phase: 'ready'; data: T; version: number }
  | { phase: 'reloading'; data: T }
  | { phase: 'error'; error: Error; lastData?: T }

interface PageController<T> {
  getState(): PageState<T>
  subscribe(cb: () => void): () => void
  reload(): Promise<void>
  destroy(): void
}
```

### Preact adapter

```ts
// Hooks
function usePageState<T>(): PageState<T>
function useLoaderData<T>(ref: LoaderRef<T>): T
function useReload(): { reload: () => void; reloading: boolean; error: Error | null }
function useAction<P, R, S>(stub: ActionStub<P, R>, options?: UseActionOptions<P, R, S>): UseActionResult<P, R>

// Components
const Page: <T>(props: PageProps<T>) => JSX.Element
const Loader: <T>(props: LoaderProps<T>) => JSX.Element        // for nested sub-pages
const Envelope: FC<EnvelopeProps>
const GuardGate: FC<{ result: GuardResult | null; children: ComponentChildren }>
```

The adapter exports map 1:1 to today's `Page` ergonomics. Consumers don't see the core directly unless they want to use it (e.g., Hono middleware calls `renderPage` directly).

## Core in detail

### `defineLoader`

```ts
type LoaderCtx = { location: RouteHook }

interface LoaderRef<T> {
  readonly __id: symbol
  readonly name: string                  // SSR key
  readonly fn: (ctx: LoaderCtx) => Promise<T>
  readonly cache?: LoaderCache<T>
}

export function defineLoader<T>(
  name: string,
  fn: (ctx: LoaderCtx) => Promise<T>,
  opts?: { cache?: LoaderCache<T> },
): LoaderRef<T> {
  return { __id: Symbol(name), name, fn, cache: opts?.cache }
}
```

The `name` is the SSR key — it's how server-rendered data is found at hydration. Names must be unique per app (typically `module:export` style: `"movie:detail"`).

### `definePage`

```ts
interface PageDescriptor<T> {
  readonly __id: symbol
  readonly name: string
  readonly loader?: LoaderRef<T>
  readonly guards: { server: GuardRef[]; client: GuardRef[] }
  readonly cache?: LoaderCache<T>
}

export function definePage<T>(opts: {
  name: string
  loader?: LoaderRef<T>
  serverGuards?: GuardRef[]
  clientGuards?: GuardRef[]
  cache?: LoaderCache<T>
}): PageDescriptor<T> {
  return {
    __id: Symbol(opts.name),
    name: opts.name,
    loader: opts.loader,
    guards: { server: opts.serverGuards ?? [], client: opts.clientGuards ?? [] },
    cache: opts.cache ?? opts.loader?.cache,
  }
}
```

### Reactive store primitive

```ts
export function createStore<T>(initial: T) {
  let state = initial
  const subs = new Set<() => void>()
  return {
    get: () => state,
    set: (next: T | ((prev: T) => T)) => {
      const nextState = typeof next === 'function' ? (next as any)(state) : next
      if (nextState === state) return
      state = nextState
      subs.forEach(s => s())
    },
    subscribe: (cb: () => void) => {
      subs.add(cb)
      return () => { subs.delete(cb) }
    },
  }
}
```

20 lines. Identity-stable snapshots so `useSyncExternalStore` works without tearing.

### `PageController`

The orchestrator. Runs the pipeline and maintains a `PageState` store.

```ts
export function mountPage<T>(
  descriptor: PageDescriptor<T>,
  ctx: { location: RouteHook },
): PageController<T> {
  const store = createStore<PageState<T>>({ phase: 'idle' })

  let cancelled = false
  const run = async () => {
    if (cancelled) return

    // Phase 1: guards
    store.set({ phase: 'guards-running' })
    const guards = isBrowser() ? descriptor.guards.client : descriptor.guards.server
    const guardResult = await runGuards(
      guards.map(g => g.fn),
      ctx,
    )
    if (cancelled) return
    if (guardResult) {
      store.set({ phase: 'guard-result', result: guardResult })
      return
    }

    // Phase 2: loader
    if (!descriptor.loader) {
      store.set({ phase: 'ready', data: ({} as T), version: 0 })
      return
    }

    // Preload check (browser-only — hydrating server-rendered data)
    if (isBrowser()) {
      const preloaded = readPreloaded<T>(descriptor.loader.name)
      if (preloaded !== null) {
        descriptor.cache?.set(preloaded)
        store.set({ phase: 'ready', data: preloaded, version: 1 })
        return
      }
      // Cache check
      if (descriptor.cache?.has()) {
        store.set({ phase: 'ready', data: descriptor.cache.get()!, version: 1 })
        return
      }
    }

    // Fetch
    store.set({ phase: 'loading' })
    try {
      const data = await descriptor.loader.fn(ctx)
      if (cancelled) return
      if (isBrowser()) descriptor.cache?.set(data)
      store.set({ phase: 'ready', data, version: 1 })
    } catch (err) {
      if (cancelled) return
      store.set({ phase: 'error', error: err instanceof Error ? err : new Error(String(err)) })
    }
  }

  void run()

  return {
    getState: store.get,
    subscribe: store.subscribe,
    reload: async () => {
      const current = store.get()
      if (current.phase === 'reloading') return
      if (current.phase !== 'ready' && current.phase !== 'error') return

      const lastData = current.phase === 'ready' ? current.data : current.lastData
      if (lastData !== undefined) {
        store.set({ phase: 'reloading', data: lastData })
      } else {
        store.set({ phase: 'loading' })
      }

      try {
        const data = await descriptor.loader!.fn(ctx)
        if (cancelled) return
        if (isBrowser()) descriptor.cache?.set(data)
        store.set({ phase: 'ready', data, version: (store.get() as any).version + 1 })
      } catch (err) {
        store.set({
          phase: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
          lastData,
        })
      }
    },
    destroy: () => { cancelled = true },
  }
}
```

Key properties:

- **Cancellation on destroy**: late resolutions don't update a destroyed controller's store.
- **Reload preserves last data**: the `reloading` phase carries previous data, so consumers can show a "refreshing" indicator while existing UI stays put.
- **Errors preserve `lastData`**: if a reload fails, the previous data is still available — consumers can render stale-with-error.
- **No throwing.** All async paths set state. Components branch on `state.phase`.

### `prefetch`, `reload`, `invalidate`

These work on `LoaderRef`, not on a mounted page — so they're callable from anywhere.

```ts
const prefetchedTasks = new WeakMap<LoaderRef<unknown>, Promise<unknown>>()

export async function prefetch<T>(
  ref: LoaderRef<T>,
  ctx: { location?: RouteHook } = {},
): Promise<T> {
  const existing = prefetchedTasks.get(ref) as Promise<T> | undefined
  if (existing) return existing

  const fakeLocation = ctx.location ?? ({ path: '', query: {} } as RouteHook)
  const promise = ref.fn({ location: fakeLocation }).then((result) => {
    if (isBrowser()) ref.cache?.set(result)
    prefetchedTasks.delete(ref)
    return result
  })
  prefetchedTasks.set(ref, promise)
  return promise
}

export function invalidate(ref: LoaderRef<unknown>): void {
  ref.cache?.invalidate()
}
```

`reload(ref)` is implemented by the active `PageController` — exposed only when there's a mounted page that owns the loader.

### `dispatchAction`

The fetch logic from `useAction`, lifted verbatim:

```ts
export interface ActionHooks<TPayload, TResult> {
  onChunk?: (chunk: string) => void
}

export async function dispatchAction<TPayload, TResult>(
  stub: ActionStub<TPayload, TResult>,
  payload: TPayload,
  hooks?: ActionHooks<TPayload, TResult>,
): Promise<TResult> {
  const s = stub as unknown as { __module: string; __action: string }
  let response: Response
  if (hasFileValues(payload)) {
    const fd = new FormData()
    fd.append('__module', s.__module)
    fd.append('__action', s.__action)
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (key === '__module' || key === '__action') continue
      if (value instanceof File) fd.append(key, value)
      else if (typeof value === 'string') fd.append(key, value)
      else fd.append(key, JSON.stringify(value))
    }
    response = await fetch('/__actions', { method: 'POST', body: fd })
  } else {
    response = await fetch('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: s.__module, action: s.__action, payload }),
    })
  }

  if (!response.ok) {
    const body = (await response.json()) as { error?: string }
    throw new Error(body.error ?? `Action failed with status ${response.status}`)
  }

  const ct = response.headers.get('Content-Type') ?? ''
  if (ct.includes('text/event-stream')) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        hooks?.onChunk?.(decoder.decode(value, { stream: true }))
      }
      const tail = decoder.decode()
      if (tail) hooks?.onChunk?.(tail)
    } finally {
      reader.releaseLock()
    }
    return undefined as unknown as TResult
  }
  return (await response.json()) as TResult
}
```

Pure JS. Testable with `fetch` mocked. Reusable from a Worker, a CLI, a test fixture.

### SSR (`renderPage` / `hydratePage`)

The SSR pipeline becomes a pure function:

```ts
export async function renderPage<T>(
  descriptor: PageDescriptor<T>,
  ctx: { location: RouteHook },
): Promise<{ state: PageState<T>; serializedData: Record<string, string> }> {
  // Run guards
  const guards = descriptor.guards.server
  const guardResult = await runGuards(guards.map(g => g.fn), ctx)
  if (guardResult && 'redirect' in guardResult) {
    throw new GuardRedirect(guardResult.redirect)
  }
  if (guardResult && 'render' in guardResult) {
    return { state: { phase: 'guard-result', result: guardResult }, serializedData: {} }
  }

  if (!descriptor.loader) {
    return { state: { phase: 'ready', data: ({} as T), version: 0 }, serializedData: {} }
  }

  const data = await descriptor.loader.fn(ctx)
  return {
    state: { phase: 'ready', data, version: 1 },
    serializedData: { [descriptor.loader.name]: JSON.stringify(data) },
  }
}

export function hydratePage<T>(
  descriptor: PageDescriptor<T>,
  preloaded: Record<string, unknown>,
): void {
  if (!descriptor.loader) return
  const data = preloaded[descriptor.loader.name]
  if (data === undefined) return
  descriptor.cache?.set(data as T)
}
```

Server flow:

1. Hono route handler calls `renderPage(descriptor, { location })`.
2. Get `{ state, serializedData }`. Inject `serializedData` into the HTML as either a script tag or attribute.
3. Render the Preact tree. Adapter's `<Page>` reads from `getState()` which is already 'ready'.
4. Stream HTML to client.

Client flow:

1. Read SSR-injected data (e.g., from `<script id="__iso_data" type="application/json">{...}</script>`).
2. Call `hydratePage(descriptor, parsed)` to seed caches before mount.
3. Mount the Preact tree. Adapter's `<Page>` calls `mountPage` → cache hits → state goes straight to 'ready'.

**The big SSR win**: hydration is keyed by loader name, not by `useId`. No fiber-position fragility. Renaming a component doesn't break SSR. Reordering components doesn't break SSR. The serialized data lives in *one* known place (a script tag at the document root), not scattered across DOM nodes.

## Adapter in detail

### `<Page>`

```tsx
const PageContext = createContext<PageController<unknown> | null>(null)

export function Page<T>({
  descriptor, location, fallback, errorFallback, children,
}: PageProps<T>) {
  const controller = useMemo(
    () => mountPage(descriptor, { location }),
    [descriptor, location.path],
  )

  useEffect(() => () => controller.destroy(), [controller])

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,  // SSR snapshot
  )

  if (state.phase === 'guard-result') {
    if ('redirect' in state.result) {
      if (isBrowser()) {
        const { route } = useLocation()
        useEffect(() => { route(state.result.redirect) }, [])
        return null
      }
      throw new GuardRedirect(state.result.redirect)
    }
    if ('render' in state.result) {
      const F = state.result.render
      return <F />
    }
  }

  if (state.phase === 'idle' || state.phase === 'guards-running' || state.phase === 'loading') {
    return fallback ?? null
  }

  if (state.phase === 'error') {
    return errorFallback ? errorFallback(state.error, controller.reload) : null
  }

  // 'ready' or 'reloading'
  return (
    <PageContext.Provider value={controller as PageController<unknown>}>
      {children}
    </PageContext.Provider>
  )
}
```

About 40 lines. No Suspense, no thrown promises. Branches on state.phase. The fallback prop is normal JSX, not a Suspense boundary.

### `useLoaderData`

```tsx
export function useLoaderData<T>(ref: LoaderRef<T>): T {
  const ctrl = useContext(PageContext)
  if (!ctrl) throw new Error('useLoaderData must be used inside <Page>')

  const state = useSyncExternalStore(
    ctrl.subscribe, ctrl.getState, ctrl.getState,
  )

  if (state.phase !== 'ready' && state.phase !== 'reloading') {
    throw new Error(`useLoaderData called when page state is ${state.phase}`)
  }

  return state.data as T
}
```

Notice: `useLoaderData` is only valid in the `ready`/`reloading` phases. Since `<Page>` only renders `children` in those phases, this invariant holds. But if a consumer somehow reads outside `<Page>`, the error fires.

### `useAction`

```tsx
export function useAction<P, R, S = unknown>(
  stub: ActionStub<P, R>,
  options?: UseActionOptions<P, R, S>,
): UseActionResult<P, R> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [data, setData] = useState<R | null>(null)
  const reloadCtx = useContext(ReloadContext)

  const optsRef = useRef(options); optsRef.current = options

  const mutate = useCallback(async (payload: P) => {
    setPending(true); setError(null)
    const opts = optsRef.current
    let snapshot: S | undefined
    if (opts?.onMutate) snapshot = opts.onMutate(payload)

    try {
      const result = await dispatchAction(stub, payload, { onChunk: opts?.onChunk })
      setData(result)
      opts?.onSuccess?.(result, snapshot as S)

      if (opts?.invalidate === 'auto') {
        const reload = opts.reload ?? reloadCtx?.reload
        const cache = opts.cache
        if (reload) reload()
        else if (cache) cache.invalidate()
      } else if (Array.isArray(opts?.invalidate)) {
        opts.invalidate.forEach(name => cacheRegistry.invalidate(name))
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      opts?.onError?.(e, snapshot as S)
    } finally {
      setPending(false)
    }
  }, [])

  return { mutate, pending, error, data }
}
```

The fetch logic is in `dispatchAction`. The hook is bookkeeping + invalidation. Same `cache` / `reload` decoupling proposed in directions #2 and #3 — works because `dispatchAction` is independent.

## Consumer migration

The migration shape is similar to direction #3 — every page changes — but the new shape is:

```tsx
// === Before ===
function MovieDetail({ loaderData }: LoaderData<Movie>) {
  return <h1>{loaderData.title}</h1>
}
export default getLoaderData(MovieDetail, { serverLoader: movieLoader, cache: movieCache })

// === After ===
const movieLoader = defineLoader<Movie>(
  'movie:detail',
  async ({ location }) => fetchMovie(location.params.id),
  { cache: movieCache },
)
const moviePage = definePage({
  name: 'movie',
  loader: movieLoader,
  cache: movieCache,
})

function MovieDetail() {
  const movie = useLoaderData(movieLoader)
  return <h1>{movie.title}</h1>
}

export default ({ location }) => (
  <Page descriptor={moviePage} location={location} fallback={<Spinner />}>
    <MovieDetail />
  </Page>
)
```

A `getLoaderData` compat shim is feasible (same as in #3), so migration can be gradual.

## Consumer scenarios

### 1. Default page

```tsx
<Page descriptor={moviePage} location={location} fallback={<Spinner />}>
  <MovieDetail />
</Page>
```

### 2. Custom error UI

```tsx
<Page
  descriptor={moviePage}
  location={location}
  fallback={<Spinner />}
  errorFallback={(err, retry) => <CustomError error={err} onRetry={retry} />}
>
  <MovieDetail />
</Page>
```

`errorFallback` is a first-class `<Page>` prop because the page state machine has an explicit `error` phase. No external error boundary needed.

### 3. SSR via Hono middleware

```ts
// In a Hono handler — pure JS, no Preact
app.get('/movie/:id', async (c) => {
  const { state, serializedData } = await renderPage(moviePage, {
    location: { path: c.req.path, params: c.req.param() },
  })

  if (state.phase === 'guard-result' && 'redirect' in state.result) {
    return c.redirect(state.result.redirect)
  }

  // Inject data + render Preact tree
  const html = renderToString(<App />)
  return c.html(`
    <!doctype html>
    <html>...
      <script id="__iso_data" type="application/json">${JSON.stringify(serializedData)}</script>
      <div id="root">${html}</div>
    </html>
  `)
})
```

The Preact render call is decoupled from data fetching. The data was already loaded by `renderPage`; the Preact render is purely a string template.

### 4. Hover prefetch

```tsx
<a href="/movie/42" onMouseEnter={() => prefetch(movieLoader, { location: { path: '/movie/42' } })}>
  Watch
</a>
```

### 5. Standalone mutation modal (no Page)

```tsx
function FeedbackModal() {
  const { mutate, pending } = useAction(serverActions.submitFeedback, {
    invalidate: 'auto',
    cache: feedbackCache,
  })
  return <Form onSubmit={mutate} disabled={pending} />
}
```

### 6. Edge prefetch in a Worker

```ts
// Cloudflare Worker — no DOM, no Preact
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/preheat/')) {
      const movieId = url.pathname.split('/').pop()!
      const data = await prefetch(movieLoader, {
        location: { path: `/movie/${movieId}`, params: { id: movieId } } as RouteHook,
      })
      await env.KV.put(`movie:${movieId}`, JSON.stringify(data), { expirationTtl: 300 })
      return new Response('ok')
    }
    // ...
  },
}
```

### 7. Test loaders without rendering

```ts
import { mountPage } from '@hono-preact/iso-core'

test('movie page loads correctly', async () => {
  const ctrl = mountPage(moviePage, { location: mockLocation('/movie/42') })
  await waitForPhase(ctrl, 'ready')
  expect(ctrl.getState()).toMatchObject({ phase: 'ready', data: expect.objectContaining({ id: '42' }) })
})
```

No JSX. No DOM. Just async + state assertions.

## File structure

```
packages/
  iso-core/
    src/
      define-loader.ts        # ~25 lines
      define-guard.ts         # ~15 lines
      define-page.ts          # ~25 lines
      store.ts                # ~25 lines
      page-controller.ts      # ~120 lines
      action-dispatch.ts      # ~80 lines (lifted from action.ts)
      preload.ts              # ~30 lines (script-tag-based)
      ssr-serialize.ts        # ~20 lines
      cache.ts                # (existing)
      cache-registry.ts       # (existing)
      guards.ts               # (existing — runGuards extracted)
      types.ts                # PageState, LoaderRef, etc.
      index.ts                # public re-exports
    package.json              # zero framework deps

  iso-preact/
    src/
      use-page-state.ts       # ~15 lines
      use-loader-data.ts      # ~25 lines
      use-action.ts           # ~50 lines
      use-reload.ts           # ~10 lines
      page.tsx                # ~50 lines
      loader.tsx              # ~30 lines (sub-page composition)
      envelope.tsx            # ~20 lines
      guard-gate.tsx          # ~25 lines
      legacy-get-loader-data.tsx  # compat shim
      contexts.ts             # PageContext
      index.ts
    package.json              # depends on iso-core + preact
```

Net code is somewhat larger than today (~600 lines of core + ~250 of adapter vs ~400 today), but each unit is small, focused, and independently testable.

## Migration plan

This is the longest migration of the four directions. Phased:

**Phase 1 — Carve out the core (PRs 1–3).**
Split the existing package into `iso-core` and `iso-preact` workspaces. Move pure-JS files (cache, cache-registry, guards, wrap-promise, preload, is-browser) into `iso-core`. No behavior change. This is mostly file moves and import updates.

**Phase 2 — Build the new core (PRs 4–7).**
Add `defineLoader`, `defineGuard`, `definePage`, `createStore`, `mountPage`, `dispatchAction`. Don't wire to the adapter yet. Test the core in isolation with vitest — no rendering involved.

**Phase 3 — Build the new adapter (PRs 8–10).**
Add `<Page>`, `<Loader>`, `useLoaderData`, etc. in `iso-preact`. Both the old `Page` and the new `<Page>` exist. Migrate the smallest internal page (e.g., a debug or admin page) to the new adapter to validate ergonomics.

**Phase 4 — `useAction` decoupling (PR 11).**
`useAction` adapter calls `dispatchAction` from core. Add `cache`/`reload` options. `ReloadContext` fallback retained. Same shape as in #2 / #3 but the underlying dispatch is in core.

**Phase 5 — SSR pipeline change (PRs 12–13).**
Update Hono middleware to call `renderPage` from core, inject data via script tag, hydrate via `hydratePage`. Verify SSR-then-hydrate works for migrated pages. Older pages still use the existing `useId`-based path until migrated.

**Phase 6 — Per-page migration (PRs 14+).**
Move pages to the new `<Page descriptor={...}>` shape. Each page is a small, mechanical PR. Old `getLoaderData` shim stays.

**Phase 7 — Cleanup.**
Once all pages migrate, delete the old `Page` and the `useId`-based preload path. Major version bump.

Realistically, 15–20 PRs over multiple weeks/months. Single-PR delivery is possible for a small app like this one but creates a giant review.

## Risks & open questions

1. **Suspense ergonomics genuinely lost.** Today's "render the page; the framework handles loading" is replaced with explicit `fallback` prop. Slightly more verbose; less elegant. The compensating wins are debuggability and explicit error states. Net: probably a wash for the consumer, but the *feel* of the API changes. Worth showing both side-by-side to the team before committing.

2. **No streaming SSR by default.** Today's Suspense-throwing model integrates with React/Preact streaming (server flushes shell, then chunks as data arrives). Pure-JS `renderPage` resolves all data before rendering. To support streaming, `renderPage` would need to expose an async generator of `(loaderName, data)` chunks, and the Preact adapter would need to coordinate. Doable but real work.

3. **Concurrent rendering compatibility.** `useSyncExternalStore` is designed for concurrent mode and tearing avoidance. As long as we use it correctly (identity-stable snapshots, server snapshot fn provided), this should work cleanly with future Preact concurrent features.

4. **Page state lifecycle.** When does a `PageController` get destroyed? Today, `useEffect`'s cleanup destroys it on unmount. Fine for the common case. But if a route is "mounted" twice (e.g., transitions, optimistic navigation), we get double mounts. Need to verify cancellation logic handles overlap correctly.

5. **SSR data inflation.** Injecting all loader data into a single script tag at the root means a larger initial HTML payload. Not different from today (data already inlined into `data-loader` attrs), but consolidated. Watch for security issues with `JSON.stringify` of arbitrary data (XSS via `</script>` injection — use `JSON.stringify(...).replace(/</g, '\\u003c')`).

6. **Loader name collisions.** Two loaders with the same `name` would collide in the SSR data dictionary. Need either runtime registration with collision detection, or a build-time check, or rely on convention (`module:export` names). Document; add a development-mode warning.

7. **`useLoaderData` runtime check.** Same as #3 — there's a runtime error if you call it outside a `<Page>` or in the wrong phase. Less type-safe than today's prop-based approach. Documented constraint.

8. **Action dispatch outside React.** `dispatchAction` calls `fetch` directly. In a Worker, `fetch` is global. In Node SSR, `fetch` may be `undefined` (depending on Node version) — but actions only run client-side anyway, so this is not a real issue. Just worth noting.

9. **Bundle size.** Tree-shakable; the core is small enough. Two packages instead of one means more resolution work for bundlers but trivial in practice.

10. **Type-level work.** `LoaderRef<T>` flowing through `definePage` to `mountPage` to `getState()` typed correctly is doable but careful generics work. Worth a TS spike before committing.

## What this does *not* solve

- **The page composition vocabulary.** Pure-JS core is orthogonal to whether the *adapter* uses props (#2) or declarative children (#3). Both shapes work over the same core. You'd still need to pick #2 or #3 as the adapter style — this direction doesn't choose for you.
- **Type safety on `useLoaderData`.** Same runtime check as #3.
- **Mutation invalidation strategy.** Same as before — `cacheRegistry.invalidate(name)` is the mechanism. Works fine, doesn't get fundamentally better.

## Comparison with #2 and #3

| | #2 Hooks | #3 Components | #4 Pure-JS Core |
|---|---|---|---|
| Surface change | None for consumers | Per-page refactor | Per-page refactor + new package layout |
| Internal change | Modest | Larger | Largest |
| Adapter substitutability | No | No | Yes (React/Vue/Solid possible) |
| Use outside render tree | No | No | Yes (SSR, Workers, tests) |
| Suspense usage | Yes | Yes | No |
| SSR keying | `useId` | `useId` | Loader name |
| Concurrent rendering compat | Native | Native | Via useSyncExternalStore |
| Streaming SSR | Yes (default) | Yes (default) | Requires extra design |
| Migration cost | ~0 | Per-page (mechanical) | Per-page + workspace split |
| Test ergonomics | Render-required | Render-required | Pure-JS tests possible |
| Adds dependency | None | None | None (custom store, ~25 lines) |
| Strategic posture | Tactical fix | Tactical-to-strategic | Strategic |

## Bottom line

Direction #4 is the most ambitious, with the largest upside if iso is meant to outlast its current setting. It pays for itself if any of these come true:

- Iso ships as a separate library someone else uses.
- Future features need to run outside the render tree (Worker prefetch, Hono middleware, automated testing).
- The rendering layer (Preact) gets replaced or augmented (React adapter, native, etc.).
- SSR streaming becomes a target (the core already supports the right shape).

It's overkill if iso stays scoped to "the data layer for this one Preact app and its known consumers." For that scope, #2 or #3 give 80% of the composability benefit at 20% of the migration cost.

The tell: if you find yourself thinking *"if only iso could run server-side without a Preact dependency"* — that's #4 paying for itself. If your wishes are all in component-land — #2 or #3.

Direction #4 is also **complementary**, not exclusive: a pure-JS core can have a hooks-based adapter (#2) or a components-based adapter (#3). The core is the foundation; the adapter is a separate decision. The cleanest end state is #4 + #3 — pure-JS substance, declarative shape — but that's also the largest delivery.
