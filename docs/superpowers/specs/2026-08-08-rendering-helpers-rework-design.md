# Rendering helpers rework: `<For>` / `<Show>` on per-row Signal cells

**Date:** 2026-08-08
**Issue:** #355 (cut from the signals release in `1d0dd6c3`, #342 A7)
**Target:** v0.13
**Prior art:** branch `feat/signals-rendering-helpers` (the cut code, restored verbatim in `889d8ef9`); branch `spike/for-vnode-cache` (`e80b4262`, the deliberately-red characterisation of the frozen-row failures); `docs/superpowers/specs/2026-07-24-signals-dx-design.md` (original design); `docs/superpowers/specs/2026-07-22-signals-migration.md` ("Phase 4 CUT" records why).

## Problem

The cut `<For>` cached each row's vnode by key. The cache is simultaneously what stopped a surviving row re-rendering on a join/leave and what froze that row against every non-signal input it closed over. In a renderer that re-creates JSX every render (Preact, unlike Solid), the two cannot be separated. Three undocumented failures followed:

1. `by` on index freezes the whole list (stable key, changing item at that key).
2. A row closing over any parent state goes stale.
3. A no-`by` list of freshly-deserialised objects remounts everything (identity changes every payload).

The spike's attempted fix left 2 of its 10 tests red and broke the test that asserts the freeze as the feature. That collision is the finding: the cached-vnode design is unfixable, not buggy.

## Decision summary

- **Scope:** rework `<For>`, land `<Show>` alongside it, resolving all of #355 in one v0.13 feature.
- **Child signature:** both arguments reactive: `(item: ReadonlySignal<T>, index: ReadonlySignal<number>) => ComponentChildren`.
- **Vnode cache: dropped.** Every `<For>` re-render re-invokes all rows with fresh closures. This fixes all three failures by construction, including failure 2, which per-row cells alone cannot fix.

### The granularity model (boundary-based, not bail-based)

With the cache gone, re-invocation is what delivers fresh `item`/`index` when `each` changes; the cells are not the delivery mechanism for that case. What the helper still provides:

- **A per-row component boundary.** An inline signal read in a row (e.g. `member(id).value`) subscribes and re-renders that row alone, not the parent. This is the everyday granularity win over an inline `.map()` in the parent's JSX.
- **A stable per-row reactive identity.** The cell pair per surviving key is object-stable across renders, so a consumer can pass `item` into their own stable/memoized subcomponent or an effect and have it update from the cell independent of the render-prop closure. This is the granularity escape hatch the plain `(item: T, index: number)` shape cannot offer.
- **Reactive `index` under reorder** for rows that display position.
- **Staleness is unrepresentable.** There is no captured plain `item`/`index` to go stale, whether or not future changes reintroduce any bailing.

Cost accepted: a membership change (join/leave/reorder) costs O(n) render-prop calls. Surviving keys keep their DOM via Preact keyed reconciliation (no remount, no DOM churn); membership changes are the rare event next to per-row data changes.

## `<For>` design

```tsx
export type ForProps<T> = {
  each: ReadonlySignal<readonly T[]>;
  /** Derive a stable, unique key per item. Defaults to the item itself. */
  by?: (item: T, index: number) => unknown;
  children: (
    item: ReadonlySignal<T>,
    index: ReadonlySignal<number>
  ) => ComponentChildren;
};
```

Internals:

- A ref-held `Map<key, { item: Signal<T>; index: Signal<number> }>` of per-row cells.
- Each render: read `each.value` (subscribes `<For>` to the list); for each item, compute the key (`by` or identity), get-or-create the cell pair, and write the current item and index into the cells (signal `===` dedupe makes unchanged writes free); evict departed keys; throw on duplicate keys (kept from the shipped design, same message shape).
- Emit one keyed `<Item>` component per row, fresh every render (no vnode cache). `<Item>` invokes `children(cells.item, cells.index)` inside its own component boundary.
- SSR: single render pass creates cells fresh; no hydration-specific handling needed. The branch's `rendering-helpers-ssr.test.tsx` coverage carries over.

## `<Show>` design

Restored verbatim from `feat/signals-rendering-helpers`. It has no cache and no staleness class; its truthiness gate (`when.value` read, narrowed function child in its own `ShowItem` boundary) was reviewed and is correct. No signature change.

## Testing

- `for.test.tsx` carries over except `a join/leave does NOT re-invoke surviving rows`, which inverts by design: the new assertion is that survivors re-invoke with fresh, correct cells and that their DOM nodes are preserved by key (no remount). Assert DOM-node identity across the membership change.
- Port the spike's five staleness characterisation cases (`for-staleness.mutcheck.test.tsx`) and require all green: by-on-index with a replaced array, row closing over parent state, freshly-deserialised objects without `by` (no remount storm under `by`), plus the two formerly-documented `item`/`index` capture cases, which the new signature makes live.
- New tests: cell object-stability across renders for surviving keys; reactive `index` on reorder; granular update through a cell into a consumer's stable subcomponent without re-invoking sibling rows; duplicate-key throw; type-level tests (`rendering-helpers.test-d.ts`) for the new child signature.
- `show.test.tsx` and `rendering-helpers-ssr.test.tsx` restore from the branch; SSR tests for `<For>` update to the new signature.
- `roster-signal-identity.mutcheck.test.tsx` stays decoupled from `<For>` (holds the member binding in a ref, as the rooms docs instruct). Do not re-couple it; that coupling is part of how the roster P0 stayed invisible.

## Mechanics and scope

- Work in a dedicated worktree on a branch off `origin/main` (then `pnpm wt:setup`). Start from the content of the branch's restore commit (`889d8ef9`): `index.ts` exports, `hono-preact` re-export test, docs pages, size-probe entries, SSR tests. Then rework `for.tsx` and its tests to this design. Do not merge the branch as-is.
- Docs: `signals.mdx` plus the pages that reference the helpers (loaders, rooms, and any others the branch touched) get the new child signature, describing what is (no migration breadcrumbs, per docs policy). The `<For>` doc explains the boundary-based granularity model and the `by` contract.
- Size tracking: the branch's `size-probe-config` / `core-size-floor` entries for the helpers carry over; verify the marginal size after the rework.
- API status: new public API for v0.13, not a breaking change; the helpers never shipped.
- Out of scope: any change to `roster-signal-identity` coupling; store-level API changes; the shipped `.map()` pattern remains fully supported and documented.
