# Loader loading-state model (drop preact/compat, the right way)

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Supersedes:** PR #172 (vendored compat-free `Suspense`). That PR is parked and stale (pre-v0.8, pre-#175 `ActionStub`->`ActionRef` rename). This work is a fresh branch off post-v0.8 `main`; #172 will be closed. The small mechanical compat-removal bits from #172 are reused (see below).

## Goal

Stop loading `preact/compat` anywhere in the shipped framework runtime, so its global `options` renderer patches never run. Achieve it by **replacing the framework's suspense-based loader loading model with a state-based one** (a `loading` flag in `.View()`, with the user owning the loading render tree) and leaning on **preact-iso's public `ErrorBoundary`** for the remaining suspension points. This deletes the vendored `Suspense` entirely, so the mangled-internal-name coupling that PR #172 had to take on never exists.

## Background

Compat enters the framework runtime through `@hono-preact/iso`'s own imports (the `apps/site` `@preact/compat` aliases are a red herring; nothing imports `react`):

- `Suspense` from `preact/compat` in `internal/loader.tsx`, `internal/route-boundary.tsx`, `internal/page-middleware-host.tsx`
- `useSyncExternalStore` from `preact/compat` in `use-action-result.ts`, `use-form-status.ts`

Plus two Vite vectors: `@preact/preset-vite`'s default `reactAliasesEnabled: true` (aliases `react` -> `preact/compat`) and `'preact/compat'` in `resolve.dedupe`.

PR #172 removed all of this by **vendoring** a compat-free `Suspense` ported from preact's `compat/src/suspense.js`. It worked, but because `@hono-preact/iso` builds unmangled it had to reference preact's private mangled property names directly, a coupling a preact/preact-iso core maintainer nudged us away from: prefer preact-iso's `ErrorBoundary`, because `Suspense`'s fallback-swap rarely beats its thrashing cost; pair a non-fallback boundary with a loading affordance the app owns. This design takes that nudge.

### Why state-based loaders dissolve the hard problem

The reason the vendored `Suspense` was complex is **SSR-DOM hydration adoption** (keep the server markup, do not discard it to a fallback, when the client re-suspends). If loaders **never suspend**, SSR and client hydration render the *same* branch, so there is no mismatch and no adoption machinery at all. Route code-splitting suspension is already preact-iso's job (the framework uses preact-iso's `lazy`/`Router`, which keep the previous route during a lazy nav); our vendored `Suspense` never caught that.

## Design

### 1. Loader runner stops throwing; exposes loading as state

`internal/use-loader-runner.tsx` already holds `reloading` and `status` in `useState` and wraps the fetch in `wrapPromise` (which throws while pending = the suspension). Reshape it to **not throw**: expose a reactive snapshot `{ data, loading, error, reload, status }` where

- `data` is `Serialize<T> | undefined` (undefined on a cold load with no prior value; the **previous value is retained during a reload** for stale-while-revalidate),
- `loading` is true while a fetch is in flight (cold load or reload),
- `error`, `reload`, `status` keep their current meaning.

### 2. `.View()` render-arg shape

Single-value `.View()` (`SingleValueView<T>`): the render fn args gain `loading: boolean` and `data` becomes `Serialize<T> | undefined`; the `fallback?` option is **removed**. The user branches on `loading` / `error` / `data` and renders all states themselves.

Accumulating `.View()` (live loaders, `AccumulatingView<T>`): keeps `status: StreamStatus` (which already encodes connecting/open/... richer than a boolean) and does **not** gain a separate `loading`; its `fallback?` option and the SSR fallback anchoring are removed (the live View renders its `status === 'connecting'` branch on SSR and hydration).

`defineLoader({ fallbackDelay })`, `DelayedFallback` (the #136 delayed-fallback feature), and the live-loader `useId`-anchored fallback `<section>` are all **deleted**: with keep-content + state-based loading, a fast navigation never flashes anything, which is exactly what #136 was approximating.

### 3. `internal/loader.tsx`

Remove the `<Suspense fallback>` wrapping and the `DataReader`-throws. `LoaderHost` renders the `.View()` render fn directly with the runner's `{ data, loading, error, reload, status }`. The `LoaderIdContext` / `useId` plumbing that existed for Suspense hydration anchoring is removed where it only served the fallback anchor.

### 4. `internal/route-boundary.tsx`

Keep the `ErrorBoundary` (catches genuine render-time errors, re-throws framework outcomes per its existing `isOutcome` guard). **Drop the `<Suspense>`**: once loaders do not throw, it has nothing to catch (route-lazy is preact-iso's Router's job).

### 5. `internal/page-middleware-host.tsx` (the load-bearing one)

The page middleware chain still **suspends** (throws a promise) as its SSR-prerender await mechanism, and the `DeferredHost` initial-load path (which fixed the redirect double-mount, #63, by rendering SSR children during hydration and running the client chain post-hydration) stays unchanged. The only change: the `HostConsumer` post-navigation boundary uses **preact-iso's `ErrorBoundary`** instead of vendored `Suspense`. On SSR, `renderToStringAsync` catches the thrown promise regardless of boundary type (it is compat-agnostic); on the client, preact-iso's already-installed `options.__e` patch routes the throw to `ErrorBoundary`'s `_childDidSuspend`, which keeps content and re-renders on resolve (no fallback). No vendored Suspense, no mangled names in our code.

### 6. Delete vendored Suspense; never introduce it

There is no `internal/suspense.tsx` on this branch (it was only on #172). This design simply never adds it, and adds no mangle-map guard test.

### 7. Mechanical compat-removal bits (reused from #172)

- Delete the `react`/`react-dom`/`react-is` `@preact/compat` aliases from `apps/site/package.json`.
- `packages/vite/src/hono-preact.ts`: `...preact({ reactAliasesEnabled: false })` and remove `'preact/compat'` from `resolve.dedupe` (+ the negative assertion in its test, + the `leak-test` fixture).
- Swap the two `useSyncExternalStore` call sites (`use-action-result.ts`, `use-form-status.ts`, on this branch they use the post-#175 `ActionRef` type) to a new internal `useStoreSnapshot(subscribe, getSnapshot)` (compat-free `useReducer`+`useEffect`+`subscribe`).
- Docs: `vite-config.mdx` dedupe row.

## Data flow

- **SSR**: data loaders run and are awaited on the server; SSR renders the `loading === false` branch with data. Live loaders do not run on the server; SSR renders the `status === 'connecting'` branch. Page middleware chain suspends; `renderToStringAsync` awaits it.
- **Initial client hydration**: renders the same branch the server did (data present, or connecting), so no hydration mismatch. Page middleware uses `DeferredHost` (SSR children during hydration, client chain post-hydration).
- **Client navigation / reload**: loader fetch sets `loading = true` with the previous `data` retained; the user's render shows their loading affordance; on settle `loading = false` with fresh data. preact-iso's Router keeps the previous route during a route-lazy nav.

## Breaking-change surface (next release notes)

- `.View()` render-arg shape changes: `data` is now `Serialize<T> | undefined` and a `loading: boolean` arg is added; the `fallback` option is removed (both View forms).
- `defineLoader({ fallbackDelay })` is removed; the delayed-fallback behavior (#136) is gone (subsumed by keep-content).
- Compat-removal consequences (as in #172, diff-invisible): `reactAliasesEnabled: false` (consumers relying on the implicit `react -> preact/compat` alias must add it themselves); compat's global `options` patches no longer load; `'preact/compat'` removed from `resolve.dedupe`.

Every `.View()` call site in `apps/site` migrates in the same PR.

## Non-goals

- No global, app-wide loading indicator or framework-provided loading UI. Loading is a loader-local concern surfaced as state; users own the render.
- No change to preact-iso's route code-splitting / `Router` suspension handling.
- Not making the page middleware chain state-based (it keeps suspending, just on preact-iso's `ErrorBoundary`).

## Risks

1. **page-middleware-host migration** (highest): the SSR-prerender await, the `DeferredHost` hydration path, and the redirect double-mount fix (#63) must all still hold with preact-iso's `ErrorBoundary` in place of vendored `Suspense`. Covered by the existing render/streaming/middleware-host suites + the #63 integration behavior; verify explicitly.
2. **Live-loader SSR/hydration** under no-fallback: the `status === 'connecting'` branch must render identically on server and client (no mismatch) and flip cleanly on the first chunk.
3. **Stale-while-revalidate correctness**: retaining the previous `data` while `loading` during a reload, and resetting it appropriately on navigation to a different loader/route.
4. **Breaking `.View()` migration**: all site call sites + docs examples must move to the `loading`/`data?` shape; type changes surface at compile time (good).

## Verification

Mirror the 8-step pre-push CI gate, plus:

1. No `preact/compat` / `@preact/compat` import in shipped source; built `apps/site/dist` client bundle has zero compat runtime signatures (`forwardRef`, `PureComponent`, `CAMEL_PROPS`, `hoistNonReact`) and no `@preact/compat`.
2. Loader / hydration / streaming-SSR / page-middleware-host suites pass, rewritten for the state-based model (no fallback assertions; assert `loading` transitions and stale-while-revalidate data retention instead).
3. The #63 redirect-double-mount behavior is preserved (no stacked routes on an initial-load client redirect).
4. `format:check`, `typecheck`, `test:types`, framework build, site build green.
