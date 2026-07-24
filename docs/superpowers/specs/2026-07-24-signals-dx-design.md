# Signals DX: rendering helpers and streaming-loader signals (signals migration, Phase 4)

Date: 2026-07-24
Status: Design approved (scope + the three API decisions), pending written-spec review.
Branch: `feat/signals-dx` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phase 5 (signals as the always-on data layer). Depends on the
always-on foundation and the ambient `@preact/signals` Preact integration.

## 1. Problem / decision

Phase 1 shipped granular presence with the keyed consumption pattern
`memberIds.value.map((id) => <Row sig={member(id)} />)`. That is granular on the
frequent case (a presence update re-renders only the moved row) but coarse on
membership change: a join or leave re-renders the mapping consumer and all its
rows, keyed reconciliation aside. Phase 2 shipped single-value loader signals
(`useDataSignal` / `useFieldSignal`) but left streaming/live loaders with `never`
for those methods; a live loader can only be read through the accumulating
`.View(render, { initial, reduce })`.

Phase 4 is the signals developer-experience phase. It ships two independent
pieces the earlier phases deferred, both on the always-on foundation:

- **Part A, rendering helpers.** A keyed `<For>` that closes the join/leave
  granularity gap, and a `<Show>` companion.
- **Part B, streaming-loader signals.** A signal read channel for live loaders,
  so the whole loader surface (single-value and streaming) has a signal form.

The owner selected both parts for this cut, plus these three API decisions
(recorded 2026-07-24):

1. `<For>` is **general**: `each: ReadonlyReactive<readonly T[]>`, `by?: (item, i)
   => Key` defaulting to identity. It serves both the presence keyed-ids pattern
   and arbitrary arrays of objects.
2. **`signal.map()` is dropped.** The charter named it, but it requires
   monkey-patching `@preact/signals`' `Signal` prototype, which the framework does
   not own (the public reactive type is `ReadonlyReactive`, an interface). `<For>`
   is the non-hacky primitive with the same capability, so no prototype extension
   and no standalone `mapSignal` ship.
3. Streaming reads **overload `useDataSignal`**: on a live loader it returns
   `ReadonlyReactive<StreamState<Serialize<T>>>` (collapsing the `never`); the
   folded accumulator gets its own method, since accumulation needs `initial` /
   `reduce` arguments the single-value form does not.

## 2. The ambient-subscription invariant (why the guard holds)

`@preact/signals` (v2.9.4, the Preact-integrated build) installs an ambient
integration: any component that reads a signal's `.value` during render
auto-subscribes and re-renders when that signal changes, without importing
`@preact/signals` itself. Phases 1-2 already rely on this (neither `loader.tsx`
nor `use-room.ts` imports `@preact/signals`; they read `.value`).

Consequence for Part A: `<For>` and `<Show>` are **pure Preact components** that
read `.value` off a `ReadonlyReactive` and never import `@preact/signals`. So
they add no new importer to the signal graph, and Phase 5's module-graph guard
(`@preact/signals` reached only through the two factory modules) stays true. The
guard is extended (not weakened) to assert `for.tsx` / `show.tsx` do not import
`@preact/signals`.

Part B lives in `define-loader.ts` / `loader-signal.ts`, which are already inside
the sanctioned signal graph, so it stays within the guard as-is.

## 3. Part A: `<For>` and `<Show>`

### `<For>`

```
<For each={reactiveArray} by={keyOf}>
  {(item, index) => <Row .../>}
</For>
```

- `each: ReadonlyReactive<readonly T[]>` (e.g. `memberIds`, or a signal of any
  array). Read `each.value` in `<For>`'s render, which auto-subscribes `<For>`.
- `by?: (item: T, index: number) => Key`, default identity (`(item) => item`),
  which is exact for `memberIds` (the ids are the keys).
- children: `(item: T, index: number) => ComponentChildren`.

Mechanism (the granular win): `<For>` keeps a per-key cache of rendered vnodes in
a ref (`Map<Key, VNode>`). On each render it reads `each.value`, computes the key
for each item, reuses the cached vnode for a surviving key, invokes the child fn
only for a newly appeared key, and drops cache entries for departed keys. The
output vnode array is keyed by `Key`, so Preact reconciles by key. The result:

- **Update** (a member's own signal changes): only that `<Row>` re-renders (it
  subscribes to `member(id)` itself); `<For>` does not re-run because `each`
  (the id list) did not change.
- **Join / leave** (`each` changes): `<For>` re-renders and diffs keys, but
  surviving rows keep their cached vnode (child fn not re-invoked, same vnode
  reference), so Preact bails on them; only the added/removed rows mount/unmount.

The presence gap closes without re-rendering the parent's surviving rows.

### `<Show>`

```
<Show when={reactiveBool} fallback={<Empty/>}>
  {children}
</Show>
```

- `when: ReadonlyReactive<unknown>`; renders `children` when `when.value` is
  truthy, else `fallback` (default `null`). Subscribes to `when.value`.
- children may be a node or `(value) => ComponentChildren` for the narrowed
  truthy value, mirroring the common Solid `<Show>` ergonomics.

Both are small, side-effect-free, and tree-shakeable; they enter a bundle only
when imported.

## 4. Part B: streaming-loader signals

Reshape the `Live extends true ? never : ...` arms of the `LoaderRef` type so a
live loader gains real signal methods, and wire them off the same per-host
signal-backed source the accumulating `.View` already reads (`loader.tsx`), via
the same `derive` / `LoaderViewSignalContext` mechanism Phase 2 used for the
single-value path.

- **`useDataSignal()`** (overloaded on `Live`):
  - single-value loader: `ReadonlyReactive<LoaderState<Serialize<T>>>`
    (unchanged from Phase 2).
  - live loader: `ReadonlyReactive<StreamState<Serialize<T>>>` (was `never`) -
    the latest per-chunk discriminated stream state as a signal.
- **`useFieldSignal(select, fallback)`** (overloaded on `Live`): projects one
  field, deriving off the `LoaderState` (single) or `StreamState` (live) signal.
  Was `never` on live.
- **`useAccumulatedSignal(initial, reduce)`** (NEW, live loaders only; `never` on
  single-value): `ReadonlyReactive<Acc>`, the folded accumulator as a signal,
  updated per chunk. Mirrors `.View(render, { initial, reduce })`; the reducer
  and seed are the same shape `.View` accepts, so the fold logic is shared, not
  duplicated.

This is a **widening of `never`** on the live arm (nothing could consume `never`,
so no existing call breaks); it is an additive public-API change, recorded in the
umbrella release notes, not a breaking change.

## 5. SSR

Unchanged in shape from Phases 2 and 5. The server provides the one-shot
`{ value: state }` on `LoaderViewSignalContext` (a `StreamState` `connecting`
snapshot for a live loader, matching the accumulating `.View`'s SSR contract; no
value baked, since the accumulating consumer reconnects via SSE on mount). The
client creates the real signal source. `<For>` / `<Show>` render on the server
by reading `.value` once (no subscription server-side); an empty `each`
renders nothing, a `connecting` stream renders its fallback. The `@preact/signals`
options patches under `preact-render-to-string` are already proven safe
(Phases 1-2 SSR tests, the #287 scar); those tests stay.

## 6. Placement, exports, size

**New files:**

- `packages/iso/src/for.tsx` - `<For>` (+ its `ForProps` type). Pure Preact.
- `packages/iso/src/show.tsx` - `<Show>` (+ `ShowProps`). Pure Preact.

Exported from the core barrel `packages/iso/src/index.ts` and re-exported through
`hono-preact` as usual. They are tree-shaken, so they enter a bundle only when
imported.

**Modified:**

- `packages/iso/src/define-loader.ts` - reshape the `LoaderRef` live arms;
  implement the live `useDataSignal` / `useFieldSignal` / `useAccumulatedSignal`
  bodies off the streaming source.
- `packages/iso/src/internal/loader-signal.ts` - any shared `derive` helper the
  accumulating signal needs (the folded-accumulator projection), kept inside the
  sanctioned importer.
- `packages/iso/src/internal/__tests__/signals-always-on.test.ts` - extend the
  guard: assert `for.tsx` / `show.tsx` do NOT import `@preact/signals`.

**Size:** core stays 5521 B (nothing new enters the `index.ts` always-loaded
graph; the barrel re-exports tree-shake). `<For>` / `<Show>` get their own probe
bucket(s) (`for`, `show`, or a shared `signals-dx`); they are tiny pure Preact and
import no `@preact/signals`, so they add zero to the signal floor. The streaming
signal glue folds into the `loaders` bucket. Numbers reported in the PR.

## 7. Testing

- **`<For>`** (unit): update path re-renders only the changed row (mutation-check:
  break the per-key cache and the test must fail because surviving rows re-render);
  join/leave mounts/unmounts only the changed keys and leaves survivors' vnodes
  referentially stable; `by` keys correctly for arrays of objects; reorder keeps
  identity.
- **`<Show>`** (unit): toggles children/fallback on `when.value`; passes the
  narrowed value to a function child; renders fallback while falsy.
- **Streaming signals** (unit): `useDataSignal()` on a live loader yields a
  `StreamState` signal that advances `connecting -> open -> closed` across chunks;
  `useAccumulatedSignal` folds per chunk; `useFieldSignal` projects off the stream
  state. Mutation-check the per-chunk update.
- **SSR** (kept + extended): a live loader's `useDataSignal` renders the
  `connecting` snapshot server-side; `<For>` / `<Show>` render through
  `preact-render-to-string`.
- **Module-graph guard**: extended for `for.tsx` / `show.tsx`.
- **Types** (`*.test-d.ts`): the live-arm reshape (real methods, no longer
  `never`); `<For>`'s `by` default and inference; `useAccumulatedSignal`'s `Acc`.
- All eight pre-push steps.

## 8. Scope (not in this phase)

- No change to caching, preload, reload, the reader machinery, the presence or
  loader data flow, or the single-value loader signal behaviour. Part B only adds
  the live arm; the single-value arm is untouched.
- No `signal.map()` / `mapSignal` (decision 2). No prototype extension of any
  `@preact/signals` type.
- No Phase 3 work (optimistic / action-form store conversion); that is a separate
  stacked phase.
- No new `@preact/signals` importer: Part A stays pure Preact, Part B stays in the
  existing sanctioned modules.

## 9. Risks

- **`<For>`'s per-key cache is the whole value.** If it re-invokes the child for
  survivors (or fails to drop departed keys), it either loses the granularity win
  or leaks vnodes. The mutation-checked update test and a leave test that asserts
  cache eviction are the safety net; both must fail when the cache logic is broken.
- **Stale-closure in cached children.** A cached vnode closes over the props at
  first render. For the presence pattern the child reads `member(id)` (a signal),
  so per-member updates flow through the signal, not through re-invoking the child,
  which is correct. A child that closes over non-signal changing values would go
  stale; document that `<For>` children should read reactive state through signals
  (the framework idiom), not captured props.
- **Live-arm type reshape breadth.** Flipping `never` to real types across
  `useDataSignal` / `useFieldSignal` and adding `useAccumulatedSignal` touches the
  `LoaderRef` conditional types; the `*.test-d.ts` assertions must pin both arms so
  the single-value arm is not collaterally changed.
- **SSR parity for the streaming signal.** The server `connecting` snapshot must
  match the client's first render exactly (the accumulating `.View` contract), or
  hydration mismatches. The kept SSR tests plus a new live-loader `useDataSignal`
  SSR case cover this.
