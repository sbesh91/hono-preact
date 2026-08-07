# Loader read-side signal mirror (signals migration, Phase 2)

Date: 2026-07-23
Status: Design approved (scope), pending written-spec review.
Branch: `feat/loader-signal-mirror` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phase 0 (decomposed loader runner) and Phase 1 (`ReadonlyReactive`, the
`hono-preact/signals` entry, the `@preact/signals` dependency), both merged into
the umbrella. Supersedes the loader portions of `2026-07-21-first-party-signals-design.md`,
whose "reactive-cell" mechanism is replaced by Phase 1's registration pattern.

## 1. Problem

A loader's data is delivered to consumers through `LoaderDataContext`
(`loader.tsx:256`): `LoaderHost` holds the phase in `useState`
(`use-loader-runner.tsx:79`), re-renders on every change, and re-provides the
projected `LoaderState` on the context. `.View()` and `useData()` read that
context. So every loader update (a revalidation, a live push) re-renders the
whole `.View` subtree, even a component that only reads one field of the data.

## 2. Goal

A component under a `<Loader>` can bind ONE field of the loaded data and have it
update **without re-rendering the `.View` subtree**. Delivered additively:
`.View()` / `.useData()` / `.Boundary` are unchanged, and an app that does not
import `hono-preact/signals` pays no new bytes.

```ts
const title = serverLoaders.default.useFieldSignal((d) => d.title, '');
return <h1>{title}</h1>; // updates alone when d.title changes
```

### 2a. The honest scope limit

Loader data is one value, not a keyed collection (unlike presence). So the
granular unit is a **field**, not a row. A list rendered from loader data still
re-renders as a whole on revalidation; per-row loader granularity would need a
keyed-collection contract (how to derive stable ids, how revalidation diffs) and
is explicitly out of scope (a possible later phase). Phase 2 delivers field-level
binding.

## 3. The mirror law for loaders (differs from Phase 1)

Phase 1 *retired* the host re-render (`useRoom` stopped calling `setMembers`),
because a presence consumer maps a collection and subscribes only to `memberIds`.
**Loaders are the opposite and must keep the host re-render.** `.View()` /
`useData()` read `LoaderDataContext`, which only updates when `LoaderHost`
re-renders; skipping that re-render freezes every existing consumer (the loader
spike proved this). So:

- `LoaderHost` keeps `setPhase` and keeps re-providing `LoaderDataContext`,
  exactly as today. `.View` / `useData` behaviour is byte-identical.
- In signal mode the runner ALSO writes each phase to a signal (a mirror), and
  `LoaderHost` provides that signal on a new context.
- `useDataSignal()` / `useFieldSignal()` read the signal, not the data context.

**Why this yields a win despite the host re-rendering.** A `useFieldSignal`
consumer is a child passed to `<Loader>` as `children`. When `LoaderHost`
re-renders internally (its own `setPhase`), the `children` vnode reference is
unchanged (it came from the app, which did not re-render), so Preact bails and
the child does NOT re-render from the host. A `useData` consumer, by contrast,
re-renders because it is a *context* consumer (context propagation fires
regardless of vnode identity). So on a loader update: `useData` consumers
re-render (context), and each `useFieldSignal` node re-renders only via its own
signal. No `memo`. This is the loader analog of the stable-children property the
loader spike established.

## 4. The reactive seam (reuse Phase 1)

`internal/reactive.ts` already has the structural `ReadonlyReactive<T>` and the
registration pattern. Phase 2 adds a loader-side registration beside the presence
one, in the same file:

```ts
export type LoaderReactiveImpl = {
  /** A settable signal cell mirroring one loader's phase. */
  createPhaseCell<T>(initial: T): PhaseCell<T>;
  /** A memoized projection off a reactive source. */
  derive<T, R>(source: ReadonlyReactive<T>, select: (v: T) => R): ReadonlyReactive<R>;
};

export type PhaseCell<T> = {
  /** Write without notifying during render is the caller's discipline; the cell
   * just sets. */
  set(value: T): void;
  /** The reactive read side, handed to useDataSignal. */
  readonly source: ReadonlyReactive<T>;
};

registerLoaderReactiveImpl(impl | null): void
getLoaderReactiveImpl(): LoaderReactiveImpl | null
```

`ReadonlyReactive<T>` stays `{ readonly value: T }`; a `Signal` satisfies it.
Core never imports `@preact/signals`.

## 5. Two implementations

**Default (core, no signals).** `getLoaderReactiveImpl()` is null. The runner
does not create a mirror; `useDataSignal()` falls back to a `{ value }` that
reads the current `LoaderDataContext` value (coarse: a consumer updates through
the context re-render, same as `useData`). Zero new bytes.

**Signal-backed (opt-in).** `signals.ts` (the existing `hono-preact/signals`
entry) additionally registers a `LoaderReactiveImpl` whose `createPhaseCell`
returns a `Signal`-backed cell and whose `derive` returns a `computed`. Importing
the entry is what makes `useFieldSignal` granular.

## 6. Wiring

### 6a. Runner (`use-loader-runner.tsx`)

`setPhase` is the single write point for phase (Phase 0 routed all writes through
it; the reload machine and readers use `LoaderPhaseOps.setPhase`). Wrap it once:
in signal mode, create a `PhaseCell<LoaderState<T>>` at mount, and after each
`setState` also `cell.set(project(phase))` where `project` is the same
`toLoaderView`-derived `LoaderState` the host puts on context. Expose
`viewSignal: ReadonlyReactive<LoaderState<T>> | null` on `LoaderRunnerState`
(null in default mode).

Render purity: the cell write happens where `setPhase` already runs (effects /
event callbacks / the post-settle handlers), never introducing a notify during
the render pass. The one render-time `setPhase({tag:'loading'})` on nav
(`use-loader-runner.tsx:230`) writes the cell too; a signal write there is a
state mutation, not a subscriber notify mid-render of THIS component, and is
verified by the SSR/nav tests.

### 6b. Host (`loader.tsx`)

`LoaderHost` provides the runner's `viewSignal` on a new
`LoaderViewSignalContext` (structurally typed `{ readonly value: unknown } | null`
in core, no signal import), alongside the existing `LoaderDataContext`. Unchanged
otherwise.

### 6c. Ref API (`define-loader.ts`)

Add two methods to `LoaderRef` (single-value only; `never` on streaming, like
`useData`):

```ts
useDataSignal(): ReadonlyReactive<LoaderState<Serialize<T>>>;
useFieldSignal<R>(select: (data: Serialize<T>) => R, fallback: R): ReadonlyReactive<R>;
```

`useDataSignal` reads `LoaderViewSignalContext`; in signal mode returns the
runner's signal, else a `{ value }` over `LoaderDataContext`. `useFieldSignal`
composes: in signal mode `derive(dataSignal, s => s.status==='loading' ? fallback
: select(s.data))`; in default mode a `{ value }` computing the same from the
context. Value-presence stays structural (`status`-based), never `data ===
undefined`.

## 7. SSR (mirror Phase 1)

`useDataSignal` / `useFieldSignal` are read during SSR only if a component calls
them; they read the same context the SSR host provides, so they yield the SSR
value with no signal machinery required server-side (the signal cell is created
lazily and never drives SSR). The `@preact/signals` options patches are already
proven safe under `preact-render-to-string` (Phase 1's SSR test; the #287 scar).
Add a loader-specific SSR test with the signals entry installed.

## 8. Testing

- **Field granularity, mutation-checked (signal mode).** A `<Loader>` with two
  children: one calls `useData()` and renders the list, one calls
  `useFieldSignal(d => d.title)`. A revalidation re-renders the `useData` child
  (context) and updates the `useFieldSignal` node, and the `useFieldSignal`
  child's component re-renders exactly once via its signal, NOT from the host.
  The load-bearing assertion: a SECOND `useFieldSignal` child bound to a
  different field does NOT re-render when only the first field changes. Mutation
  check: making `derive` non-reactive (return a plain snapshot) fails it.
- **Default coarseness.** Without the signals entry, `useDataSignal().value` /
  `useFieldSignal(...).value` return correct values; a consumer updates through
  the context path; no `@preact/signals` in the module graph.
- **`.View` / `.useData` parity.** The existing loader suite stays green,
  unchanged (mirror law: the context path is untouched).
- **SSR with signals installed.** `useFieldSignal` renders to a string, no throw,
  correct SSR value.
- **Streaming loaders reject `useDataSignal`** with a clear error (like
  `useData`), since `status` is separate state (deferred).

## 9. Scope

- Single-value loaders only. Streaming (`accumulate`) loaders throw on
  `useDataSignal` / `useFieldSignal` (their `status` lives in a second `useState`;
  mirroring it is a distinct follow-on).
- No keyed loader collections (§2a).
- No change to caching, preload adoption, reload, or the reader machinery.

## 10. Modularity

- `internal/reactive.ts` gains the loader registration beside presence (both are
  small structural seams; keep them in the one reactive module).
- `signals.ts` gains the loader impl registration beside presence.
- `use-loader-runner.tsx` gains the mirror write and `viewSignal` on its return.
- `loader.tsx` gains one context provider.
- `define-loader.ts` gains two ref methods.
- New: nothing large; the field-signal projection is a few lines.

## 11. Risks

- **The one render-time `setPhase` on nav** (§6a). A cell write there must not
  notify a subscriber synchronously during this component's render. Signals
  schedule notifications, and no component subscribes to a just-created cell
  mid-first-render, so this is safe, but it is the render-purity edge to test.
- **`useDataSignal` outside a `<Loader>`** must throw the same clear error
  `useData` does (no context), not silently return an inert signal.
- **Referential stability.** `useDataSignal()` must return the SAME signal across
  re-renders of the calling component (memoized per loader instance), or a
  binding resubscribes each render. `useFieldSignal` likewise memoizes its
  `derive` per (loader, selector-call-site).
