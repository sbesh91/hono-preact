# Composability Analysis: `packages/iso/` Page Components

Research pass on `packages/iso/src/page.tsx` and the surrounding `iso` package, focused on identifying composability problems, coupling issues, and extension friction in `Page` / `GuardedPage`.

## 1. Package surface map

Core vocabulary exported from `packages/iso/src/index.ts`:

- **Data loading**: `getLoaderData`, `useReload`, `Loader`, `LoaderData`
- **Caching**: `createCache`, `LoaderCache`, `cacheRegistry`
- **Guards**: `createGuard`, `runGuards`, `GuardRedirect`, `GuardFn`, `GuardResult`
- **Preload / SSR**: `getPreloadedData`, `deletePreloadedData` (DOM-based hydration)
- **Promise wrapping**: `wrapPromise` (internal Suspense boundary support)
- **Server actions**: `defineAction`, `useAction`, `ActionStub`, `UseActionOptions`, `UseActionResult`
- **Optimistic UI** (new): `useOptimistic`, `useOptimisticAction`, `OptimisticHandle`, `UseOptimisticActionOptions`
- **Forms**: `Form`, `WrapperProps`

**Key relationships**: `Page` orchestrates Guards → preload check → cache check → fetch-and-wrap. `ReloadContext` is injected but only usable from inside `ReloadContext.Provider`. `useAction` depends on `ReloadContext` (action.ts:47).

## 2. What `Page` does — SRP violation

The `Page` / `GuardedPage` pair handles ten distinct concerns:

1. **Guard execution** (page.tsx:71–76): re-runs guards on path change; suspends until guard promise resolves.
2. **Redirect / render fallback dispatch** (page.tsx:150–162): throws `GuardRedirect` on SSR; routes on client.
3. **SSR hydration** (page.tsx:164–178): retrieves preloaded data by `useId`; populates cache.
4. **Cache layer** (page.tsx:181–194): checks cache before fetching.
5. **Server loader invocation** (page.tsx:196–201): fetches, caches, wraps in Suspense.
6. **Reload state management** (page.tsx:116–118, 131–146): tracks reloading / error; owns reload function.
7. **Override data handling** (page.tsx:117, 121–124, 174, 189, 210): allows `reload()` to bypass cache and inject fresh data.
8. **Wrapper / SSR JSON serialization** (page.tsx:233): JSON-stringifies `loaderData` to `data-loader` attribute.
9. **Child composition** (page.tsx:237): passes `loaderData` + `id` to Child component.
10. **Reloading context provision** (page.tsx:169, 184, 204): wraps tree with `ReloadContext`.

The component conflates cache checking (should be internal), guard dispatch (should be a separate boundary), reload lifecycle (should be a hook), and SSR hydration mechanics (should be delegated).

## 3. External consumers & usage patterns

From `apps/app/src/pages/`:

- **movie.tsx:76–86** — `useOptimisticAction(serverActions.toggleWatched)`: mutates `isWatched` boolean with optimistic projection.
- **movies.tsx:24–35** — `useOptimisticAction(serverActions.toggleWatched)`: same pattern over an array of watched IDs.
- **movie.tsx:24–26, 49–51** — `useAction(serverActions.setNotes)` + `useAction(serverActions.setPhoto)`: pure mutations, no optimistic layer.

**Pattern**: consumers wire `getLoaderData` + `useAction` / `useOptimisticAction` inside page components. They never interact with `Page` directly — it's hidden behind `getLoaderData` (loader.tsx:36–48). **The `Page` surface is opaque to app code.**

**Pain point**: consumers cannot customize the guard → preload → cache → fetch ordering. All are baked into `GuardedPage`. If a consumer wanted to:

- Insert a prefetch step before cache check
- Skip guard dispatch on certain paths
- Use a different cache strategy (e.g. stale-while-revalidate)

…they would have to fork `Page` or reimplement it from scratch.

## 4. Coupling points

Hardcoded assumptions that should be injectable:

| Coupling | Location | Problem |
|---|---|---|
| Guard order immutable | page.tsx:71–76 | Guards run once, cached in `guardRef`. No way to re-run or skip per-route. |
| SSR hydration tied to `useId` | page.tsx:68, 164 | ID propagation via `useId()` + DOM lookup in `getPreloadedData`. Fragile; couples SSR serialization format. |
| Cache checked before fetch | page.tsx:181–194 | No control over whether stale cache is served. Baked into the decision tree. |
| `JSON.stringify` for SSR | page.tsx:233 | Data serialized via `JSON.stringify(loaderData)` into `data-loader` attribute. Prevents non-JSON data; no custom serializer. |
| `overrideData` flow | page.tsx:117, 139, 174, 189 | `reload()` sets `overrideData` state. But "override" data is not distinguished from fetched data in the Child component — the only source of truth is the `loaderData` prop. Hard to reason about. |
| `ReloadContext` lifetime | page.tsx:169, 184, 204 | `ReloadContext` wraps `GuardedPage`. Only consumable inside its descendants. Cannot be provided higher in the tree or replaced. |
| `Wrapper` prop is the only customization | page.tsx:66, 55 | Guard handling, cache logic, Suspense boundary placement are all black-box. |
| Suspense boundary placement | page.tsx:79, 205 | Two Suspense layers: one in `Page` (guards), one in `GuardedPage` (loader). Neither is configurable. |

**Result**: `Page` is a monolith. Consumers cannot incrementally adopt features (e.g. "I want guards but not cache") or layer patterns (e.g. "I want error boundaries around guards separately from loaders").

## 5. Extension scenarios & difficulty

| Feature | Difficulty | Why |
|---|---|---|
| Optimistic updates | medium | New `useOptimisticAction` composes *alongside* `Page`, not *within* it. Consumers wire it in their components. `Page` itself needs no changes (though `useAction` needed a `TSnapshot` generic — already done in design). |
| Retry on mutation failure | hard | `useAction` would need exponential backoff + jitter. Since `useAction` is called from leaf components, consumers implement this themselves. No retry logic in `useAction` today. Would require a new hook or option. |
| Prefetch-on-hover | very hard | `Page` pre-executes the `serverLoader`. No way to trigger a prefetch "manually" from a link hover handler. Would need a public `prefetch()` export that calls `serverLoader` + caches; then a way to wire it into link elements. Currently impossible. |
| Mutation-driven cache invalidation | easy | `cacheRegistry.invalidate(name)` exists. `useAction` already triggers it via `invalidate: 'auto'`. Consumers call it manually in `onSuccess`. Works. |
| Custom error boundary per route | hard | Errors from `serverLoader` are caught by Suspense fallback or thrown as `GuardRedirect`. No structured error type. Wrapping `Page` in an error boundary works, but `Page` itself has no error state prop or error rendering capability. `loadError` state exists (page.tsx:118) but is never rendered — only stored in `ReloadContext`. |

## 6. The optimistic-UI plan & current shape resistance

**What the plans ask for** (`docs/superpowers/plans/2026-04-26-optimistic-ui-updates.md`):

- Task 1: add `TSnapshot` generic to `UseActionOptions` / `useAction`, pass snapshot through to `onSuccess` (already done).
- Tasks 2–3: implement `useOptimistic` primitive + `useOptimisticAction` wrapper (proposed; not yet in `iso/src`).
- Task 5: **refactor `<Form>` to accept `mutate` + `pending`, dropping the `action` prop.** Key composability move.
- Task 6: new docs page.

From `docs/superpowers/specs/2026-04-26-optimistic-ui-updates-design.md`:

- Emphasizes **composition**: "Introduce a primitive that projects base data plus a queue of in-flight changes."
- Explicitly notes `Page` / `GuardedPage` are **out of scope**: "Reactive caches are out of scope for this work."
- Asks `<Form>` to become a thin wrapper accepting pre-built `mutate`. Forces separation of concerns: `useAction` owns fetch / cache / invalidate logic, `<Form>` owns form submission + fieldset disabling.

**Where the current `Page` shape resists:**

1. **Form already composes independently.** The plan asks `<Form mutate={mutate} pending={pending}>`. The old `<Form>` re-implements fetch logic; the plan removes that. Works.
2. **`Page` exposes no public API for prefetching or lazy invalidation.** Consumers calling `cacheRegistry.invalidate(name)` directly works for now, but is fragile.
3. **`useAction` already depends on `ReloadContext`.** The plan's `onMutate` / `onSuccess` snapshot pattern needs `useAction` to know about snapshots (the plan adds that). But `useAction` also checks `reloadCtx` (action.ts:47) to trigger cache invalidation when `invalidate: 'auto'`. If a consumer calls `useAction` outside a `Page` context (e.g. in a standalone mutation UI), they'd hit an error or a no-op invalidate. Design does not address this.
4. **`GuardedPage`'s re-render on path change clears `overrideData`** (page.tsx:121–124). Correct for unmount / remount scenarios, but couples page lifecycle to route state in a way that `useOptimisticAction` does not expect. Example: if a consumer uses `useOptimisticAction` on a `Page`, then navigates to a sibling route and back, the optimistic queue survives (it's in the component) but `Page`'s cache is cleared. No coordination.

## Bottom line

**Biggest composability problem**: `Page` is a monolithic control-flow orchestrator. It owns guards, caching, fetching, SSR hydration, reload state, and Suspense boundaries. Consumers cannot extract or replace individual steps. The **only** extension point is `Wrapper`, which controls the DOM envelope — not the pipeline.

The **optimistic-UI plan sidesteps this** by introducing new hooks (`useOptimistic`, `useOptimisticAction`) that compose *alongside* `Page`, not *within* it. And it refactors `<Form>` to accept pre-built mutations, forcing the separation of "how to fetch" from "how to submit a form."

**What would make it composable:**

1. Extract guard dispatch, cache checking, and fetch wrapping into composable hooks, not a monolithic component.
2. Expose a public `prefetch(loader, cache?)` utility.
3. Make `ReloadContext` optional (`useAction` works outside `Page`).
4. Add error state rendering to `Page` or a separate error boundary component.
5. Invert control: let consumers build the pipeline they need (guards → cache → fetch → wrap) instead of accepting a fixed one.

Currently, the design resists incremental adoption and forces full-stack re-implementation for novel patterns.

## Three directions (in increasing radicalness)

1. **Crack open the extension surface** — add props for `onError`, custom Suspense boundary, custom serializer, optional `prefetch()` export. Lowest risk, biggest immediate payoff.
2. **Decompose into hooks** — `useGuards()`, `useLoaderWithCache()`, `useReloadable()` — and let `Page` become a default composition of them. Consumers who need a different pipeline build their own.
3. **Invert control entirely** — `Page` becomes `<Pipeline>` with declarative children (`<Guards>`, `<LoaderBoundary>`, `<Hydrate>`). Closer to React Router v7 / TanStack Router shape.

The middle path (#2) is probably the right tradeoff — it preserves the convenient default while letting the next "out of scope" feature land *inside* the package instead of beside it.
