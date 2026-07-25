# Unified reactive loader read API (signals migration, Phase 4b)

Date: 2026-07-24
Status: Design in review.
Branch: `feat/signals-streaming` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phase 5 (signals always-on) and Phase 2 (the loader signal mirror,
whose names this phase finalizes). Supersedes the "streaming-loader signals"
framing that split out of Phase 4.

## 1. Problem and decision

Phase 2 shipped the loader signal read behind opt-in-era names: a plain
`useData()` returning a value, plus `useDataSignal()` / `useFieldSignal()`
returning signals, with streaming (`live`) loaders left as `never`. Phase 5 made
signals the framework's always-on data-layer opinion, which makes that shape
wrong in two ways: the `-Signal` suffix is vestigial (there is no non-signal
`useData` to disambiguate from anymore), and `useFieldSignal` is a projection
convenience the platform already provides.

The framework owner's directive: **one reactive read primitive, adaptive on the
loader's inferred type, with no duplication.** A primitive must earn its place;
none is added lightly. Concretely, this phase finalizes the reactive read surface
that ships when the migration lands:

- **`useData` is the single reactive loader read.** Its signature is driven by
  the loader's type. On a live loader it requires the same `{ initial, reduce }`
  the accumulating `.View` already takes, so `Acc` is inferred and correctly
  typed. This absorbs both the old value-returning `useData` and Phase 2's
  `useDataSignal`, and delivers the streaming read channel Phase 2 lacked.
- **`useFieldSignal` / `useField` are removed.** Field projection is
  `useComputed` off `useData` (see 4). Projection is a signal operation the
  platform already covers; the framework does not wrap it.
- **`@preact/signals` primitives are re-exported first-party** from
  `hono-preact`, exactly as `hoofd` is (5), so projection and signal creation are
  one import surface (`hono-preact`), not a separate dependency the user reaches
  for.
- **`ReadonlyReactive` is retired in favour of `@preact/signals`' `ReadonlySignal`**
  (6). A framework-owned `{ readonly value: T }` type was a Phase 1 artifact of
  holding signals at arm's length while they were opt-in; with signals first-party
  it is duplication of the real type.

Everything here is unreleased (it exists only on the umbrella), so collapsing the
Phase 2 names and the `ReadonlyReactive` type costs no released consumer.

## 2. Guiding principles (owner-stated)

1. Unified and simple: the API surface must not get muddy.
2. No duplication: two ways to do the same thing is a defect, not a convenience.
3. Expressive, adaptive, consistent: the type tells the user what a hook needs
   and returns; the same name adapts to the loader shape.
4. Simple transition: upgrading to the signals version is mechanical, not a
   rewrite.
5. A primitive earns its place; none is added lightly.

## 3. The unified `useData`

```ts
// The loader ref's read hook, adaptive on the Live discriminant.
useData: Live extends true
  ? <Acc>(
      initial: Acc,
      reduce: (acc: Acc, chunk: Serialize<T>) => Acc,
    ) => ReadonlySignal<StreamState<Acc>>
  : () => ReadonlySignal<LoaderState<Serialize<T>>>;
```

- **Single-value loader:** `loader.useData()` returns a `ReadonlySignal` of the
  discriminated `LoaderState<Serialize<T>>` (pattern-match on `status`). Read
  `.value`.
- **Live loader:** `loader.useData(initial, reduce)` returns a `ReadonlySignal`
  of `StreamState<Acc>`; `Acc` is inferred from `initial` / `reduce`, the same
  reducer shape the accumulating `.View(render, { initial, reduce })` already
  accepts. The type system requires the reducer precisely because a live loader's
  shape needs it, and refuses it on a single-value loader.

One name, one mental model: `useData` reads the loader reactively; the loader's
type decides the signature. No cast, no `unknown`, no suffix.

## 4. Field projection is `useComputed`, not a hook

`useFieldSignal` (Phase 2) and any `useField` are removed. Its only capability
over `useData` was field-level dedup (a computed that fires when the selected
slice changes, where reading `useData().value.data.x` fires on any data change).
For single-value loaders that is marginal, loader data updates atomically on
refetch. For streaming it is real, but it is a projection of a signal, and
signals are always-on, so the platform primitive covers it:

```ts
const stream = loader.useData(0, (acc, chunk) => acc + chunk.n);
const total = useComputed(() =>
  stream.value.status === 'open' ? stream.value.data : 0,
);
```

`useComputed` is re-exported from `hono-preact` (5), so this is a single import
surface. The framework does not wrap it in a bespoke loader hook.

## 5. Re-export `@preact/signals` first-party

Mirror the existing `hoofd/preact` re-export in `packages/iso/src/index.ts`. The
framework owns the signals integration (it is the always-on data-layer opinion),
so it offers the primitives first-party rather than making apps depend on
`@preact/signals` directly. `@preact/signals` is already a direct dependency of
both `@hono-preact/iso` and `hono-preact`.

Re-exported (the stable public surface of `@preact/signals`, a coherent complete
set, not a lightly-chosen subset):

- Values / effects: `signal`, `computed`, `effect`, `batch`, `untracked`.
- Preact hooks: `useSignal`, `useComputed`, `useSignalEffect`.
- Types: `Signal`, `ReadonlySignal`.

These are tree-shakeable and side-effect free, so re-exporting from the barrel
adds nothing to the always-loaded core graph (the barrel `index.js` is excluded
from `CORE_MODULES`; an app that imports only `definePage` pulls no signals), the
same property the Phase 5 module-graph guard already pins.

## 6. Retire `ReadonlyReactive` for `ReadonlySignal`

`ReadonlyReactive<T> = { readonly value: T }` was introduced so core named no
signal shape while signals were opt-in. With signals first-party and re-exported,
it duplicates `@preact/signals`' `ReadonlySignal<T>`. Replace it:

- The read hooks and presence reads now type as `ReadonlySignal`:
  `useData(): ReadonlySignal<LoaderState<T>>`; `useRoom().memberIds:
  ReadonlySignal<readonly string[]>`; `member(id): ReadonlySignal<PresenceMember
  | undefined>`; `members: ReadonlySignal<...>`. The runtime values are already
  `computed()` / `signal()` results, so this is the accurate type, not a widening
  hack.
- Consumers gain the full read-only signal surface (`.value`, `.peek()`,
  `.subscribe()`), which is more capable (a non-subscribing `.peek()` read, an
  imperative `.subscribe()`), and is a stable library contract.
- `internal/reactive.ts` keeps only the framework-specific contracts that are not
  `@preact/signals` types: `RosterStore<S>` and `PhaseCell<T>` (their `.source` /
  member accessors retype to `ReadonlySignal`). The `ReadonlyReactive` alias is
  deleted; ~5 files update their imports.

This is the one part of the phase that touches merged phases' type surface; it is
in-scope because it removes duplication the owner's principles forbid, and it is
unreleased.

## 7. Wiring (design level; precise internals in the plan)

The API in 3 is settled. The implementation question is how `useData(initial,
reduce)` owns the fold, since the reducer now lives on the consumer, not the host.

- **The runner already folds incrementally.** `useLoaderRunner(loaderRef, ...,
  accumulate)` folds each chunk through `accumulate.reduce` into `session.acc`
  and projects `StreamState`. Folding at the point that sees every chunk (the
  runner) is required; a consumer folding a host-exposed "latest chunk" signal
  would miss chunks. So the live `useData` builds an `AccumulateOptions` from its
  args and drives the runner, reusing this incremental fold (no chunk-history
  retention, so no memory growth).
- **Single-value `useData()`** continues to read the host-provided signal context
  (the Phase 2 mechanism, `LoaderViewSignalContext`), returning it as a
  `ReadonlySignal`.

Open items the plan must resolve, prototype-first, flagged as risks (9):

1. **Uniform host requirement.** Single-value `useData()` reads a host context
   (needs a `<Loader>` / `.View` ancestor); a live `useData` that drives its own
   runner would work standalone. The plan must make the usage contract uniform,
   preferably "call `useData()` anywhere" for both (single-value driving its own
   cache-deduped runner), or, if standalone SSR suspense proves too invasive,
   keep both host-bound and document one contract. The surface in 3 does not
   change either way; only the "where can I call it" rule does.
2. **SSR.** A live `useData` renders `connecting` on the server and reconnects on
   the client (the existing streaming SSR contract); a standalone single-value
   `useData` would need to suspend on the reader server-side. The plan validates
   this against the `#287` SSR scars and the existing streaming SSR tests.
3. **Multiple live consumers** of one loader with different reducers: one shared
   stream subscription with per-consumer folds, or one subscription each. The
   plan decides against the stream registry ("one subscriber per `loaderId`") and
   documents the outcome; the common single-consumer case is unaffected.

## 8. Transition

```ts
// single-value: add .value (compiler-guided at every call site)
loader.useData()                    ->  loader.useData().value
// streaming: the {initial, reduce} carry over from .View verbatim
loader.View(r, { initial, reduce }) ->  loader.useData(initial, reduce)  // bind .value
// projection: was a bespoke hook, now the platform primitive
loader.useFieldSignal(sel, fb)      ->  useComputed(() => sel(data.value...))
// signal imports move to the framework surface
import { computed } from '@preact/signals'  ->  import { computed } from 'hono-preact'
```

Mechanical and compiler-guided. The streaming reducer the user already wrote is
reused unchanged.

## 9. The finalized signal read surface (audit)

Held to "every primitive earns its place, no duplication":

- **`useData`** (adaptive): the one reactive loader read.
- **`useRoom`: `memberIds`, `member(id)`, `members`, `self`** (kept). `member(id)`
  / `memberIds` expose the store's per-key signals and cannot be reconstructed
  with a platform `useComputed` (per-member subscription without re-rendering the
  list is the point); `members` is the coarse whole-roster read (presence's
  `useData` analogue); `self` is the identity read. No projection convenience
  among them.
- **`.View` / `.Boundary`** (kept). Render-prop is a distinct paradigm (server
  suspense on the reader, error boundaries, imperative render), not a second way
  to do `useData`. Released API; unchanged here.
- **`<For>` / `<Show>`** (Phase 4): distinct rendering primitives, no overlap.
- **Re-exported `@preact/signals`**: the platform surface, first-party.

Removed: `useDataSignal`, `useFieldSignal`, the value-returning `useData`,
`ReadonlyReactive`.

## 10. Scope (not in this phase)

- No change to `.View` / `.Boundary` behaviour or signature (the render-prop
  paradigm stays; only the hook read is unified).
- No routing, caching, reload, or reader-machinery change beyond wiring the live
  `useData` fold.
- No Phase 3 (store conversion).
- Presence read names (`memberIds` / `member` / `members` / `self`) keep their
  shapes; only their element type changes from `ReadonlyReactive` to
  `ReadonlySignal` (6).

## 11. Testing

- **`useData` single-value:** returns a `ReadonlySignal<LoaderState>`; `.value`
  settles loading -> success; a binding updates without the host re-rendering
  (the Phase 2 granularity test, retargeted to `useData`).
- **`useData` live:** `useData(initial, reduce)` yields a
  `ReadonlySignal<StreamState<Acc>>` advancing `connecting -> open -> closed`
  across chunks; the fold is correct; a binding updates granularly per chunk
  (mutation-checked). `Acc` inference pinned in `*.test-d.ts`.
- **Projection:** `useComputed` off `useData` re-renders only on the selected
  slice (the field-dedup the removed hook gave, now via the platform).
- **Re-exports:** `signal` / `computed` / `useComputed` / etc. importable from
  `hono-preact` and identical to `@preact/signals` (an export-identity test,
  like the hoofd re-exports).
- **Type surface:** the `Live`-conditional `useData` overload (single-value takes
  no args and forbids them on the value arm; live requires `initial` / `reduce`);
  `ReadonlySignal` return types; the removed names no longer export
  (`exports.test.ts`).
- **SSR:** live `useData` renders `connecting` server-side; single-value settles
  (per the resolved host contract, 7). The `@preact/signals` +
  `preact-render-to-string` patches stay proven (Phase 1-2 SSR tests, `#287`).
- **Module-graph guard:** unchanged invariant (core stays signals-free; the
  re-export barrel tree-shakes); extend it to confirm the re-export site does not
  enter `CORE_MODULES`.
- All eight pre-push steps; docs/AGENTS/corpus updated for the changed public
  surface (the removed and re-exported names).

## 12. Risks

- **Uniform host requirement (7.1) is the central risk.** If single-value
  `useData` cannot cleanly go standalone (SSR suspense), the usage contract
  differs between the two forms, which dents the "one mental model" goal. The
  plan prototypes this first and, if needed, documents a single host contract
  rather than shipping an inconsistency.
- **`ReadonlyReactive` -> `ReadonlySignal` is a wide type edit** across merged
  phases. Mitigated by its being a mechanical type-only change on unreleased
  code, pinned by `test:types` and the retargeted granularity tests.
- **Re-export drift.** Re-exporting a library surface risks it diverging from
  `@preact/signals` on a major bump. Mitigated by the export-identity test and
  the single version pin already shared by both packages.
- **Breaking the `.View` streaming path** while wiring the live `useData` fold.
  Mitigated by leaving `.View` untouched and driving the same `useLoaderRunner`
  fold the accumulating `.View` already uses.
