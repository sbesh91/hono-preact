# Loader state ADT + v0.9 review-fix design

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Branch:** `worktree-loader-loading-state` (PR #191, base `main`)
**Relates to:** [2026-06-25-loader-loading-state-design.md](./2026-06-25-loader-loading-state-design.md) (the state-based loader model this refines) and [2026-06-25-v0.9-release-notes.md](./2026-06-25-v0.9-release-notes.md) (rewritten by this work).

## Context

A `max`-effort multi-agent review of PR #191 surfaced 15 verified findings. Two are documented intent and get **no code change**:

- **#4** `reactAliasesEnabled: false` (drop `preact/compat` aliasing): the PR's purpose; release notes §3a documents it with a migration path.
- **#6** removal of `fallbackDelay` / cold-nav loading paints immediately: release notes §2 documents it; the cold-nav flash only affects first-time un-prefetched navigations, and reloads are covered by stale-while-revalidate.

The remaining findings are genuine implementation gaps in the **unreleased** v0.9 loader-consumption API. Because v0.9 is unreleased, we take the one cheap opportunity to fix the root cause rather than the symptoms: the loader value lifecycle was modelled by overloading `data === undefined` as a sentinel and by flat, independently-derived `{ data, loading, error }` fields. We replace that with an **algebraic data type (ADT)** — internally as the runner's single source of truth, and externally as a discriminated-union public API the consumer pattern-matches on.

### Decisions (settled with the maintainer)

1. **Internal:** model the single-value loader lifecycle as a discriminated union `LoaderPhase<T>` (the runner's single source of truth). Every transition is a fresh object, so a loader that resolves to `undefined` is a real state change, not a no-op `setState`.
2. **Public (Level 2):** the `.View()` render function and `loader.useData()` receive a discriminated union the consumer `switch`es on, not the flat `{ data, loading }` shape. `data` is narrowed to `T` in value-bearing arms, so the `data!` footgun cannot be written. This is folded **into** PR #191 (v0.9 never ships the flat shape).
3. **No new booleans for variant axes.** The live-vs-single SSR serialization choice (and any future loader kind) is expressed as a discriminated descriptor, not a boolean flag. We use **string-literal-union discriminants**, not the TypeScript `enum` keyword (which emits runtime code; this framework tracks client-JS size).

## Internal model: `LoaderPhase<T>`

In `internal/use-loader-runner.tsx`, the single-value value-lifecycle is one ADT, replacing the `overrideData: T | undefined` sentinel, the separate `reloading` state, and the hand-derived `data`/`loading` precedence chain:

```ts
type LoaderPhase<T> =
  | { tag: 'loading' }                          // cold: a fetch is in flight, no value yet
  | { tag: 'revalidating'; value: T }           // reload in flight, previous value retained (SWR)
  | { tag: 'success'; value: T }                // settled with a value (possibly undefined)
  | { tag: 'error'; error: Error; value?: T };  // value present => stale-while-error; absent => cold error
```

The streaming/live path keeps `status: StreamStatus` (`'connecting' | 'open' | 'closed' | 'error'`) as its discriminant; the accumulated value is held as before. `StreamStatus` is already richer than a boolean and needs no ADT replacement (`applyChunk` + `setStatus` always schedule a re-render, so the `undefined`-bail bug is single-value-only).

The runner projects the appropriate public union (below) for its consumer. Public fields used elsewhere derive from the phase:

- `data = ('value' in phase) ? phase.value : undefined`
- `loading = phase.tag === 'loading' || phase.tag === 'revalidating'`
- `reloading = phase.tag === 'revalidating'`  *(reload-only; see #5)*
- `error = phase.tag === 'error' ? phase.error : null`

## Public API: discriminated-union consumption

### Single-value loaders — `LoaderState<T>`

```ts
type LoaderState<T> =
  | { status: 'loading' }                       // cold, no data
  | { status: 'success'; data: T }              // settled value
  | { status: 'revalidating'; data: T }         // reload in flight, prior data shown (SWR)
  | { status: 'error'; error: Error; data: T }; // stale-while-error (reload failed, prior data kept)
```

The render function receives `LoaderState<T>` as its sole argument; `reload` remains available via `useReload()` (an action, not state, so it stays off the union):

```tsx
const MovieView = movie.View((s) => {
  switch (s.status) {
    case 'loading':      return <Skeleton />;
    case 'error':        return <Banner err={s.error} data={s.data} />;
    case 'revalidating':
    case 'success':      return <Movie data={s.data} />; // s.data: T, no `!`
  }
});
```

### Streaming / live loaders — `StreamState<T>`

```ts
type StreamState<T> =
  | { status: 'connecting' }                    // no data yet (SSR + pre-first-chunk)
  | { status: 'open'; data: T }                 // accumulated value
  | { status: 'closed'; data: T }               // stream ended, final accumulated value
  | { status: 'error'; error: Error; data: T }; // error, last accumulated value
```

`connecting` carries **no** `data`. The `accumulate.initial` seed is therefore purely the internal `reduce` start value — never surfaced to the render function and never serialized. This dissolves the `accumulate.initial as T` coercion casts (finding #13) and makes the SSR/hydration anchor trivially `null` (finding #3).

### `loader.useData()` (Boundary escape hatch)

Returns the same single-value union, retyped from `() => Serialize<T>` to:

```ts
useData: Live extends true ? never : () => LoaderState<Serialize<T>>;
```

Boundary consumers `switch` on it exactly like a `.View` render arg. This resolves findings #1 (docs/impl mismatch) and #2 (unsound non-nullable type) at the type level.

### Cold-error rule (keeps the boundary intact)

Invariant: **a union never carries an error without data.** Cold errors — a failed cold load, or a live stream that errors before its first chunk — have no value, so they continue to route through `LoaderHost`'s `errorFallback` and the route `ErrorBoundary`, exactly as today. This preserves the existing SSR throw path (`DataReader` rethrow) and the #63 redirect-double-mount fix. The union's `error` variant is only the with-data stale-while-error case. `errorFallback` semantics are unchanged.

## Hydration anchor: discriminated descriptor (finding #3)

`Envelope` currently decides the `data-loader` hydration attribute itself, branching on `isBrowser()` and (in the buggy state) serializing `accumulate.initial` for live SSR — which throws on a non-serializable seed (`BigInt`, circular) and produces a server `"[]"` / client `"null"` mismatch. We make `Envelope` a dumb renderer of an explicit descriptor the call sites construct:

```ts
type HydrationAnchor =
  | { kind: 'none' }                  // emit "null"
  | { kind: 'data'; value: unknown }; // emit JSON.stringify(value ?? null)
```

`Envelope`:

```tsx
const dataLoader = anchor.kind === 'data' ? JSON.stringify(anchor.value ?? null) : 'null';
```

Call sites (which already know client/server and single/live):

- client `LoaderHost` branch → `{ kind: 'none' }`
- server `DataReader`, single-value → `{ kind: 'data', value: data }`
- server `DataReader`, live → `{ kind: 'none' }`

This removes the new boolean that an earlier draft proposed, removes the `isBrowser()` branch from inside `Envelope` (the split now lives at call sites that are already client/server-specific), restores the old `data-loader="null"` live anchor, and is one variant away from extension (a future loader kind) rather than a boolean to retrofit.

## `useReload().reloading` (finding #5)

`ReloadContext` is wired to `reloading: loading` today, so the public `useReload().reloading` is `true` during a cold initial load, not just an explicit `reload()` — breaking the documented `<button disabled={reloading}>` pattern. After the ADT change, the runner surfaces the reload-only signal (`phase.tag === 'revalidating'`) and `LoaderHost` feeds `ReloadContext` that, not the combined `loading`. The `ReloadContextValue.reloading` JSDoc is corrected to "true while an explicit reload/revalidation is in flight (not a cold initial load)."

## `useStoreSnapshot` faithful port (findings #7/#11, #12)

`internal/use-store-snapshot.ts` is the compat-free `useSyncExternalStore` replacement, but it dropped two behaviors of the real hook:

- **No `Object.is` bailout (#7/#11):** it `forceUpdate()`s on every store notification. Both backing stores broadcast to *all* listeners on every write, while snapshots are per-stub, so every form submit re-renders every `useFormStatus`/`useActionResult` consumer in the tree even when its own value is unchanged.
- **No subscribe-time re-read (#12):** a store write in the commit-to-effect window is dropped until an unrelated re-render.

Both callers pass an **inline** `getSnapshot` closure, so the fix keeps `getSnapshot` and the last snapshot in refs (out of the effect deps, preserving the stable-`subscribe` contract), re-reads at subscribe time, and only `forceUpdate()`s when `!Object.is(next, prev)`:

```ts
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const value = getSnapshot();
  const valueRef = useRef(value);
  const getSnapshotRef = useRef(getSnapshot);
  valueRef.current = value;
  getSnapshotRef.current = getSnapshot;
  const forceUpdate = useForceUpdate(); // returns a stable force-update callback
  useEffect(() => {
    const check = () => {
      const next = getSnapshotRef.current();
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        forceUpdate();
      }
    };
    check(); // subscribe-time re-read closes the commit→effect tear window
    return subscribe(check);
  }, [subscribe]);
  return value;
}
```

## Cleanups

- **#14** Extract `useForceUpdate()` (the `useReducer((n) => n + 1, 0)` idiom) into one internal helper used by both `use-store-snapshot.ts` and `optimistic.ts`.
- **#9** Rewrite the stale `Suspense` JSDoc on `LoaderRef.Boundary` and the "initial Suspense fetch" comment in the runner to describe the state-based model (repo convention: docs describe what-is).
- **#13** Dissolved by `StreamState` (`connecting` has no `data`), removing both `accumulate.initial as T` casts.
- **#15** Replace the two em-dash code comments in `internal/__tests__/loader.test.tsx` (user-global no-em-dash rule) with a semicolon/colon.

## Finding → resolution map

| # | Finding | Resolution |
|---|---|---|
| 1 | `useData()` docs/impl mismatch | `useData()` returns `LoaderState<T>` union |
| 2 | `useData()` unsound non-nullable type | union narrows `data` to `T`; cold states have none |
| 3 | live-SSR serializes `accumulate.initial` | `HydrationAnchor` descriptor; live → `{ kind: 'none' }` |
| 4 | compat react-alias off | **no change** (documented intent) |
| 5 | `reloading` widened to cold loads | feed `ReloadContext` the `revalidating`-only signal |
| 6 | `fallbackDelay` removed / cold flicker | **no change** (documented intent) |
| 7/11 | `useStoreSnapshot` re-render storm | add `Object.is` bailout |
| 8 | demo discards SWR on reload | `switch` the union; keep `data` during `revalidating` |
| 9 | stale Suspense doc-comments | rewrite to state-based model |
| 10 | `undefined`-resolving loader stuck loading | `LoaderPhase` ADT (`success: { value: undefined }`) |
| 12 | `useStoreSnapshot` tear window | subscribe-time re-read |
| 13 | `accumulate.initial as T` casts | dissolved by `StreamState` (no data on `connecting`) |
| 14 | duplicated force-update reducer | shared `useForceUpdate()` |
| 15 | em-dash in new comments | replace punctuation |

(The high-run live-loaders.mdx finding is already fixed by commit `dd7a72b` on this branch.)

## Migration surface (same PR)

TypeScript surfaces every stale call site at compile time, so the migration is compiler-guided:

- **Types** (`define-loader.ts`): `SingleValueView<T>` render arg → `LoaderState<Serialize<T>>`; `AccumulatingView<T>` render arg → `StreamState<Serialize<T>>`; `useData()` return.
- **Release notes** (`2026-06-25-v0.9-release-notes.md`): breaking-change #1 documents the union, not the `loading` arg.
- **Docs examples:** `loaders.mdx`, `quick-start.mdx`, `reloading.mdx`, `live-loaders.mdx`, `loading-states.mdx`, `streaming.mdx`.
- **App + demo call sites:** all `.View` / `useData` consumers under `apps/site` (incl. `demo/task.tsx`, finding #8).

## Non-goals

- No change to #4 (compat alias) or #6 (fallbackDelay) behavior.
- Do not remove the framework-wide `loaderRef.live` boolean — same instinct, separate change, out of scope.
- No change to `page-middleware-host.tsx` suspension, the `DataReader` SSR Mechanism-B carrier, or preact-iso route-lazy handling.
- No global/framework-provided loading UI; loading stays a loader-local concern the consumer renders.

## Risks

1. **Runner reshape** (highest): the `LoaderPhase` ADT must preserve stale-while-revalidate (prior `value` retained during `revalidating`/`error`), the SSR throwing-reader (`reader`) carrier, the querystring-only-nav refetch, and the queued-reload draining. Covered by the runner/loader/streaming suites; verify explicitly.
2. **Cold-error routing:** confirm cold errors (no value) still reach `errorFallback`/boundary and only with-data errors enter the union.
3. **Live SSR/hydration:** `connecting` must render identically server and client and flip cleanly on the first chunk; `data-loader="null"`.
4. **`useStoreSnapshot` semantics:** the `Object.is` bailout must not suppress a genuine per-stub change; the subscribe-time re-read must not double-fire.

## Verification

TDD, red-first, one failing test per fix before its change:

- `undefined`-resolving single-value loader clears `loading` and renders `success` (#10).
- exhaustive `switch` over `LoaderState` / `StreamState` typechecks (`*.test-d.ts`).
- `loader.useData()` returns the union (#1/#2).
- live-loader SSR with a non-serializable `initial` (`BigInt`) does not throw and emits `data-loader="null"` (#3).
- `useReload().reloading` is `false` on a cold load, `true` during a `reload()` (#5).
- a write to store A does not re-render a stub-B `useFormStatus` consumer (#7/#11); a commit→effect-window write is not dropped (#12).
- stale-while-revalidate: prior `data` stays visible during `revalidating` (#8 demo behavior).

Then the full 8-step pre-push CI gate (build → gen:agents-corpus → format:check → typecheck → test:types → test:coverage → test:integration → site build).
