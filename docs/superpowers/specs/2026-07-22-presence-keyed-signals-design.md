# Presence roster as keyed signals (signals migration, Phase 1)

Date: 2026-07-22
Status: Design approved, pending written-spec review.
Branch: `feat/presence-keyed-signals` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Investigation: `2026-07-22-signals-first-migration-investigation.md` (§2.1, §3, P2/P4)

## 1. Problem

`useRoom` holds the presence roster in a single `useState` array
(`use-room.ts:147`). Every incoming presence frame reallocates the whole array
(`upsertMember` does `slice()` + `findIndex`, `use-room.ts:256-270`) and calls
`setMembers`, re-rendering every consumer of the hook. With N members each
emitting events, the cost is O(N x M) component re-renders, and there is no
throttling anywhere in the path.

The live-cursors demo is the concrete case: `others.map((member) => <Cursor
style={{ left: member.state.x }}/>)` (`cursors-demo.tsx:111`). Every peer's
pointer move re-renders the whole demo component and rebuilds every cursor
element, not just the one that moved. This is the single place in the framework
where the "50-issue update re-renders 50 rows" framing is literally true today.

## 2. Goal

A consumer can bind one member's presence and have a pointer move re-render only
that member's row, turning O(N x M) into O(M) targeted updates. Delivered as an
**additive** public API: existing `members` consumers are untouched, and an app
that does not opt into the granular API pays no new bytes.

## 3. Non-goals

- **Connection sharing / de-duplication** (investigation §5.3). Two hooks on the
  same room still open two sockets. That needs a general ownership scope and
  refcounting; out of scope here.
- **A general `Scope` primitive** (investigation P4). Presence needs exactly one
  disposable; a single `dispose()` wired into the existing effect cleanup covers
  it. The general primitive waits until a phase has coordinated multi-disposable
  teardown (connection sharing). Building it now would be an unused abstraction.
- **Throttling / heartbeats.** Orthogonal protocol concerns, unchanged.
- **`useSocket` last-message, WS status.** Single scalars; signals buy nothing
  over `useState`. Not touched.
- **Positioning (`use-position.ts`).** The investigation over-claimed this as a
  hot path. The code already writes x/y straight to the DOM in the `autoUpdate`
  callback and only `setState`s on a side/align/arrow change. The residual
  re-render (arrow position during shift-while-scrolling, in a small popover
  subtree) would require a breaking change to the public `PositionState` type to
  remove. Not worth it. The umbrella charter records this correction.

## 4. The reactive-value seam

Core must be able to name a reactive value without importing `@preact/signals`
(the dependency stays opt-in). One structural interface, mirroring the loader
`reactive-cell` pattern:

```ts
// packages/iso/src/internal/reactive.ts  (core; no @preact/signals import)
export type ReadonlyReactive<T> = { readonly value: T };
```

A registration point lets the opt-in signals entry swap the presence
implementation:

```ts
export type PresenceReactiveImpl = {
  /** Build the granular roster store for one room instance. */
  createRoster<S>(): RosterStore<S>;
};

let impl: PresenceReactiveImpl | null = null;
export function registerPresenceReactiveImpl(i: PresenceReactiveImpl | null): void;
export function getPresenceReactiveImpl(): PresenceReactiveImpl | null;
```

`RosterStore<S>` is the internal contract both implementations satisfy:

```ts
export type RosterStore<S> = {
  /** Apply a full snapshot (connect / reconnect). */
  snapshot(members: ReadonlyArray<PresenceMember<S>>, selfId: string): void;
  /** Apply one delta. */
  join(id: string, state: S): void;
  update(id: string, state: S): void;
  leave(id: string): void;
  /** Granular reads, exposed on the hook result. */
  readonly memberIds: ReadonlyReactive<readonly string[]>;
  member(id: string): ReadonlyReactive<PresenceMember<S> | undefined>;
  /** Release all retained reactive state and subscriptions. */
  dispose(): void;
};
```

## 5. Two implementations

**Default (core, no signals).** Backed by the roster data `useRoom` already
holds. `memberIds.value` and `member(id).value` read straight from the current
array on each access. Reads do not auto-subscribe, so a consumer re-renders
coarsely through its parent, exactly as today. Zero new bytes; `@preact/signals`
is never imported on this path.

**Signal-backed (opt-in).** Lives in the opt-in signals entry
(`packages/iso/src/signals.ts`, the eventual `hono-preact/signals` subpath). It
registers a `PresenceReactiveImpl` whose `RosterStore`:

- holds `ids: Signal<readonly string[]>` and `byId: Map<string, Signal<PresenceMember<S>>>`;
- `join`/`leave` write `ids` (membership) and add/remove a member signal;
- `update` writes exactly one member signal and does not touch `ids`;
- `member(id)` returns the member's signal (a stable `computed` for a missing id);
- `dispose()` drops the map and the ids signal.

`update` touching one signal is the whole win: the list container does not
re-render, only the bound row does. Importing the entry installs
`@preact/signals`' global `options` hooks; the spike proved they coexist with the
pinned `preact-iso` in both import orders.

## 6. Wiring in `useRoom`

`useRoom` keeps `useState<array>` as the source of truth for the existing
`members` field (mirror law: signals are an added channel, never the sole
source, until every consumer is converted). On each incoming frame it updates
both the array and the roster store:

```ts
const store = useRef<RosterStore<S>>();
if (!store.current) {
  const impl = getPresenceReactiveImpl();
  store.current = impl ? impl.createRoster<S>() : createDefaultRoster<S>(() => membersRef.current);
}
// in onRawMessage, alongside the existing setMembers(...):
//   snapshot -> store.snapshot(...); join/update/leave -> store.join/update/leave(...)
// in the existing effect cleanup:
//   store.current.dispose();
```

The hook result gains two fields, both `ReadonlyReactive`:

```ts
memberIds: store.memberIds,
member: store.member,
```

`members`, `self`, `send`, `setPresence`, `status`, `close`, `closeInfo` are
unchanged.

### Consumer shape

```tsx
// coarse (unchanged)
room.members.map((m) => ...)

// granular
room.memberIds.value.map((id) => <Cursor key={id} sig={room.member(id)} />)
// Cursor reads sig.value.state.x; only the moved member's Cursor re-renders.
```

The `key={id}` keyed map means a join/leave reconciles by key (the parent
re-renders because it read `memberIds.value`, but only the added/removed row
mounts/unmounts); a presence update fires one member signal and re-renders one
`Cursor`.

## 7. SSR and hydration (C5)

`useRoom` is called during SSR (the server def carries the real hook). The
roster store is created lazily and never connects server-side (the WS guard is
already inside the effect, which does not run in SSR). First render is an empty
roster on both implementations: `memberIds.value === []`, `member(id).value ===
undefined`, `members === []`, `status === 'connecting'`. Server and client first
renders are byte-identical, so hydration has nothing to reconcile. There is no
server-baked presence payload to adopt (unlike loaders).

## 8. Teardown (C4)

`dispose()` is called from `useRoom`'s existing effect cleanup, which already
owns the WS lifetime. The signal store drops its `Map` and `ids` signal; the
default store holds nothing to drop. No new lifecycle machinery, no module-scoped
signal that outlives the component. This is the narrow, correct teardown for one
disposable; it is deliberately not the general `Scope` primitive (§3).

## 9. The `use-store-snapshot` rationale (C6)

`use-store-snapshot.ts:5-11` says it was hand-rolled to avoid `preact/compat`
"which installs global options patches." Importing the opt-in signals entry now
installs six `options` hooks itself, so that rationale, as written, is
contradictory. It is not retracted by this change: `use-store-snapshot` is on
the always-loaded action/form path and must stay signals-free, so keeping it
hand-rolled is still correct for that path. This spec updates its comment to say
so explicitly (avoid pulling signals/compat onto the always-loaded path), rather
than leaving a rationale that reads as false once a sibling module imports
signals.

## 10. Testing

- **Roster store, both impls, same delta sequence.** snapshot -> join -> update
  -> leave; assert `memberIds.value` and `member(id).value` track correctly, and
  that a missing id yields `{ value: undefined }`.
- **Granularity, mutation-checked (signal impl).** Render a keyed list of member
  components; a single `update(id, ...)` re-renders exactly that member's
  component and not its siblings or the container. Mutation check: making
  `update` rewrite the whole `ids` signal (the wrong implementation) must fail
  this test.
- **Default impl coarseness.** Without the signals entry imported, `member(id)`
  still returns correct values; no `@preact/signals` in the module graph
  (asserted by import).
- **SSR parity.** Both impls render an empty roster with no connection during SSR
  and hydrate without mismatch.
- **Dispose.** Unmounting the room calls `dispose()`; the signal store releases
  its map.
- **Realtime integration suite stays green unchanged** (mirror law: `members`
  behaviour is identical).
- **Bundle:** the `iso` core probe is unchanged (default path, no signals). The
  signals-entry cost is measured and recorded in the umbrella charter's running
  table.

## 11. Modularity

New units, each independently testable:

- `internal/reactive.ts`: the `ReadonlyReactive` type, `RosterStore` contract,
  and the registration point. No signals, no Preact.
- `internal/default-roster.ts`: the plain implementation over a roster getter.
- `signals.ts` (opt-in entry): registers the signal-backed `RosterStore`.

`use-room.ts` gains the store wiring and two result fields; its existing
roster/`setMembers` logic is unchanged (the store is updated alongside, not
instead).

## 12. Risks

- **Two write paths in `useRoom`** (the array and the store) can drift. Mitigated
  by updating both at the same three call sites (snapshot/join/leave-or-update)
  and by the integration suite pinning `members` behaviour.
- **`member(id)` identity stability.** The signal impl must return the same
  signal object for a stable id across calls, or a binding resubscribes each
  render. The store memoizes per id.
- **The default impl's `member(id).value` reads live data each access.** Correct
  but coarse; a consumer that binds it gets no granularity and re-renders with
  its parent. This is intended and documented, not a bug.
