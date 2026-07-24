# Signals DX: keyed rendering helpers (signals migration, Phase 4)

Date: 2026-07-24
Status: Design approved. Scope narrowed to the rendering helpers; streaming-loader
signals split into their own phase (see section 8).
Branch: `feat/signals-dx` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phase 5 (signals as the always-on data layer) and the ambient
`@preact/signals` Preact integration.

## 1. Problem / decision

Phase 1 shipped granular presence with the keyed consumption pattern
`memberIds.value.map((id) => <Row sig={member(id)} />)`. That is granular on the
frequent case (a presence update re-renders only the moved row) but coarse on
membership change: a join or leave re-renders the mapping consumer and all its
rows, keyed reconciliation aside. The charter deferred a Solid-style `<For>` to a
dedicated DX phase; this is that phase.

Phase 4 ships two keyed rendering helpers on the always-on foundation:

- **`<For>`**, a keyed list helper that closes the join/leave granularity gap.
- **`<Show>`**, a conditional companion.

Two API decisions were settled during design (2026-07-24):

1. `<For>` is **general**: `each: ReadonlyReactive<readonly T[]>`, `by?: (item, i)
   => Key` defaulting to identity. It serves both the presence keyed-ids pattern
   (`each={memberIds}`, ids are the keys) and arbitrary arrays of objects
   (`by={(t) => t.id}`).
2. **`signal.map()` is dropped.** The charter named it, but it requires
   monkey-patching `@preact/signals`' `Signal` prototype, which the framework does
   not own (the public reactive type is `ReadonlyReactive`, an interface). `<For>`
   is the non-hacky primitive with the same capability, so no prototype extension
   and no standalone `mapSignal` ship.

Streaming-loader signals, originally grouped into this phase, are **split out**
(section 8) after design review surfaced a genuine typing problem that deserves
its own design pass.

## 2. The ambient-subscription invariant (why the guard holds)

`@preact/signals` (v2.9.4, the Preact-integrated build) installs an ambient
integration: any component that reads a signal's `.value` during render
auto-subscribes and re-renders when that signal changes, without importing
`@preact/signals` itself. Phases 1-2 already rely on this (neither `loader.tsx`
nor `use-room.ts` imports `@preact/signals`; they read `.value`).

Consequence: `<For>` and `<Show>` are **pure Preact components** that read
`.value` off a `ReadonlyReactive` and never import `@preact/signals`. So they add
no new importer to the signal graph, and Phase 5's module-graph guard
(`@preact/signals` reached only through the two factory modules) stays true. The
guard is extended (not weakened) to assert `for.tsx` / `show.tsx` do not import
`@preact/signals`.

## 3. `<For>`

```
<For each={reactiveArray} by={keyOf}>
  {(item, index) => <Row .../>}
</For>
```

- `each: ReadonlyReactive<readonly T[]>` (e.g. `memberIds`, or a signal of any
  array). `<For>` reads `each.value` in its render, which auto-subscribes it.
- `by?: (item: T, index: number) => Key`, default identity (`(item) => item`),
  exact for `memberIds` (the ids are the keys).
- children: a single function `(item: T, index: number) => ComponentChildren`.

Mechanism (the granular win): `<For>` keeps a per-key cache of rendered vnodes in
a ref (`Map<Key, VNode>`). On each render it reads `each.value`, computes each
item's key, reuses the cached vnode for a surviving key, invokes the child fn only
for a newly appeared key, and drops cache entries for departed keys. The output
vnode array is keyed by `Key`, so Preact reconciles by key. Result:

- **Update** (a member's own signal changes): only that `<Row>` re-renders (it
  subscribes to `member(id)` itself); `<For>` does not re-run, because `each` (the
  id list) did not change.
- **Join / leave** (`each` changes): `<For>` re-renders and diffs keys, but
  surviving rows keep their cached vnode (child fn not re-invoked, same vnode
  reference), so Preact bails on them; only the added/removed rows mount/unmount.

The presence gap closes without re-rendering the surviving rows.

**Contract for children (documented):** a cached vnode closes over the props at
first render, so `<For>` children must read changing state through signals (the
framework idiom, e.g. `member(id)`), not through captured non-signal values.
Duplicate keys throw in development (a keyed list requires unique keys); the
error names the offending key.

## 4. `<Show>`

```
<Show when={reactiveCond} fallback={<Empty/>}>
  {children}
</Show>
```

- `when: ReadonlyReactive<C>`; `<Show>` reads `when.value` (auto-subscribes),
  renders `children` when it is truthy, else `fallback` (default `null`).
- children may be a node or `(value: NonNullable<C>) => ComponentChildren`, which
  receives the narrowed truthy value (the common Solid `<Show>` ergonomics).

Both `<For>` and `<Show>` are small, side-effect-free, and tree-shakeable; they
enter a bundle only when imported.

## 5. SSR

`<For>` and `<Show>` render on the server by reading `.value` once (no
subscription server-side): an empty or `connecting` `each` renders nothing, a
falsy `when` renders its fallback. No new SSR machinery. The `@preact/signals`
options patches under `preact-render-to-string` are already proven safe
(Phases 1-2 SSR tests, the #287 scar); nothing here touches them.

## 6. Placement, exports, size

**New files:**

- `packages/iso/src/for.tsx` - `<For>` and its `ForProps<T, Key>` type. Pure
  Preact.
- `packages/iso/src/show.tsx` - `<Show>` and its `ShowProps<C>` type. Pure Preact.

Exported from the core barrel `packages/iso/src/index.ts` (value + prop types) and
re-exported through `hono-preact` as usual. They are tree-shaken, so they enter a
bundle only when imported. They land on the existing `hono-preact` main entry (no
new subpath), so the AGENTS appendix subpath gate is unaffected.

**Modified:**

- `packages/iso/src/index.ts` - export `For` / `ForProps`, `Show` / `ShowProps`.
- `scripts/size-probe-config.mjs` - add a `signals-dx` bucket (`for.js`,
  `show.js`) so the helpers are measured, not silently absorbed.
- `packages/iso/src/internal/__tests__/signals-always-on.test.ts` - extend the
  guard: `for.tsx` / `show.tsx` do NOT import `@preact/signals`.

**Size:** core stays 5521 B (nothing new enters the always-loaded `index.ts`
graph; the barrel re-exports tree-shake). The `signals-dx` bucket is tiny pure
Preact and imports no `@preact/signals`, so it adds zero to the signal floor.
Numbers reported in the PR.

## 7. Testing

- **`<For>`** (unit, `@testing-library/preact`):
  - update path re-renders only the changed row. **Mutation-check:** break the
    per-key cache (re-invoke the child every render) and the test must fail
    because a survivor re-renders.
  - join/leave mounts/unmounts only the changed keys; a leave evicts its cache
    entry (assert survivors' render count is unchanged). **Mutation-check:** skip
    the eviction and a leak/stale test must fail.
  - `by` keys arrays of objects correctly; reorder preserves row identity.
  - duplicate keys throw in development with the offending key named.
- **`<Show>`** (unit): toggles children/fallback on `when.value`; passes the
  narrowed value to a function child; renders fallback while falsy.
- **SSR** (unit): `<For>` renders its rows and `<Show>` its branch through
  `preact-render-to-string`; an empty `each` and a falsy `when` render nothing /
  the fallback.
- **Module-graph guard**: extended for `for.tsx` / `show.tsx`.
- **Types** (`*.test-d.ts`): `<For>`'s `by` default (identity infers `Key = T`)
  and object-array inference; `<Show>`'s function-child narrowing.
- All eight pre-push steps.

## 8. Streaming-loader signals: split into a future phase (recorded 2026-07-24)

Originally Part B of this phase. Design review, reading the streaming host,
surfaced that streaming consumption is **host-level and accumulating**: the
`.View(render, { initial, reduce })` (or `<Loader accumulate>`) configures the
fold, the host folds every chunk, and the `StreamState<Acc>` it writes into the
signal cell already carries the accumulated value. The accumulator type `Acc` is
chosen at the **consumption site** (the reducer), not by the loader definition, so
a read-side `useDataSignal()` called inside the host has no way to statically type
it: returning `StreamState<Serialize<T>>` (data typed as a single chunk) is a type
lie, since `.data` is the fold. There is no raw per-chunk consumption path either
(both `View` and `Boundary` require `accumulate` for streaming), so there is
nothing clean to fold read-side.

This is a real API-design question (how a read-side signal carries the
consumption-site accumulator type), not a coding detail. It gets its own spec and
phase rather than a rushed type lie here. The host plumbing needed already exists
(loader.tsx writes a `PhaseCell<LoaderState | StreamState | null>` and provides
`viewSignal` for streaming loaders today), so the future phase is a type-and-API
problem, not a plumbing one.

## 9. Scope (not in this phase)

- No streaming-loader signals (section 8). The single-value `useDataSignal` /
  `useFieldSignal` and their `never` on the live arm are untouched.
- No `signal.map()` / `mapSignal`, no prototype extension of any `@preact/signals`
  type (decision 2).
- No Phase 3 work (optimistic / action-form store conversion); a separate phase.
- No new `@preact/signals` importer: `<For>` / `<Show>` stay pure Preact.
- No change to caching, preload, reload, the reader machinery, presence, or loader
  data flow.

## 10. Risks

- **`<For>`'s per-key cache is the whole value.** If it re-invokes the child for
  survivors (losing the granularity win) or fails to drop departed keys (leaking
  vnodes), the phase delivers nothing. The two mutation-checked tests (survivor
  re-render, cache eviction) are the safety net; both must fail when the cache
  logic is broken.
- **Stale-closure in cached children.** A cached vnode closes over first-render
  props; a child that reads changing non-signal captures goes stale. Mitigated by
  documenting the signals-idiom contract (section 3) and by the presence pattern
  reading `member(id)` through a signal.
- **Key stability.** `by` must produce stable, unique keys; duplicates corrupt the
  cache. The dev-mode duplicate-key throw and a reorder-identity test cover it.
