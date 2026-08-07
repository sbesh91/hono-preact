import { signal, computed, batch, type Signal } from '@preact/signals';
import { shallowEqual } from './shallow-equal.js';
import type { PresenceMember } from './room-envelope.js';
import type { ReadonlySignal } from '@preact/signals';

/**
 * A room's roster. `useRoom` drives it with the same wire deltas it applies to
 * its `members` array; the granular reads (`memberIds` / `member`) are exposed
 * on the hook result.
 */
export type RosterStore<S> = {
  /** Replace the whole roster (connect / reconnect snapshot). */
  snapshot(members: ReadonlyArray<PresenceMember<S>>): void;
  /** Add or update one member. The store decides join vs update by whether the
   * id is already known, matching `useRoom`'s existing upsert semantics. */
  upsert(id: string, state: S): void;
  /** Remove one member. */
  leave(id: string): void;
  /** Membership ids; changes on join/leave only. */
  readonly memberIds: ReadonlySignal<readonly string[]>;
  /** The whole roster as one reactive array. Reading it subscribes to every
   * member, so a coarse `members` consumer updates on any change; `useRoom`
   * exposes it as the `members` result field. */
  readonly members: ReadonlySignal<ReadonlyArray<PresenceMember<S>>>;
  /** One member's entry; changes only when THAT member changes. */
  member(id: string): ReadonlySignal<PresenceMember<S> | undefined>;
  /** Release retained reactive state. Called from `useRoom`'s effect cleanup. */
  dispose(): void;
  /**
   * How many member cells this store is still holding: present members plus
   * departed ones something else is still reading. The retention bound is only
   * a claim if it can be observed, and this is how the tests observe it.
   */
  retainedCellCount(): number;
};

/**
 * The signal-backed roster: `member(id)` is a per-member signal, so a presence
 * update patches one bound row instead of re-rendering every consumer.
 */
// RETENTION. A cell must outlive its member: a consumer may hold `member(id)`
// across any roster mutation, so leave and snapshot BLANK a cell (write
// `undefined` into it, notifying whoever holds it) rather than dropping it.
// Dropping it outright is what made a departed member render forever, because
// the holder stayed subscribed to a cell nothing would ever write again.
//
// But a presence key space is unbounded, unlike `createFieldErrorStore`'s (one
// form's fields), so holding every cell for the life of the hook grows the
// store by ids ever seen. A long-lived room with churn has no bound at all.
//
// So a blanked cell moves from `live` to `departed`, which holds it WEAKLY.
// That splits the two requirements cleanly:
//
//  - Something still reading the cell keeps it reachable, so `member(id)`
//    returns the SAME cell on a rejoin and the holder simply updates. The
//    guarantee above is unchanged, and it is enforced by reachability rather
//    than by a policy that has to be remembered.
//  - Nothing reading it makes it garbage, and the id's entry is removed when
//    it is collected. Churn costs one weak entry per departed id in the
//    interval before the GC runs, not one live signal forever.
//
// Reclamation is therefore the GC's call and not immediate: this bounds the
// store asymptotically, it does not cap it at any instant. That is the honest
// trade, and it is the right one here, because the alternatives either cap the
// map and silently orphan an old held binding, or keep introspecting
// subscribers, which @preact/signals does not expose.
export function createSignalRoster<S>(): RosterStore<S> {
  const ids = signal<readonly string[]>([]);
  // Cells for members currently in the roster, held strongly.
  const live = new Map<string, Signal<PresenceMember<S> | undefined>>();
  // Cells for departed members, held weakly: present only while someone else
  // is reading them. `member(id)` promotes one back into `live` on a rejoin.
  const departed = new Map<
    string,
    WeakRef<Signal<PresenceMember<S> | undefined>>
  >();
  // Drops the id's weak entry once its cell is collected. Guarded on the entry
  // still being the one that died, so a rejoin that promoted the id back into
  // `live` (and later blanked a NEW cell) is not clobbered by a late callback
  // for the old one.
  const finalizers = new FinalizationRegistry<string>((id) => {
    if (departed.get(id)?.deref() === undefined) departed.delete(id);
  });
  // The whole roster as one derived array. Reading it subscribes to `ids` AND
  // every member signal, so a coarse `members` consumer updates on any change.
  // A granular consumer reads `member(id)` instead and updates per member.
  const members = computed<ReadonlyArray<PresenceMember<S>>>(() => {
    const out: PresenceMember<S>[] = [];
    for (const id of ids.value) {
      // Every id in `ids` is a present member, and a present member's cell is
      // always in `live`, so this needs no departed lookup.
      const v = live.get(id)?.value;
      if (v !== undefined) out.push(v);
    }
    return out;
  });

  /**
   * The one cell for this id: live, else the departed one if it is still
   * reachable, else a fresh one. A fresh cell starts DEPARTED (weak), so a
   * `member(id)` probe for someone who is not in the room is retained by the
   * caller holding it and by nothing else.
   */
  function resolve(id: string): Signal<PresenceMember<S> | undefined> {
    const alive = live.get(id);
    if (alive) return alive;
    const held = departed.get(id)?.deref();
    if (held) return held;
    const s = signal<PresenceMember<S> | undefined>(undefined);
    departed.set(id, new WeakRef(s));
    // Registered once, at creation: a cell moves between the two maps over its
    // life, but it only ever dies once.
    finalizers.register(s, id);
    return s;
  }

  /** This id is in the roster now: hold its cell strongly. */
  function promote(id: string, s: Signal<PresenceMember<S> | undefined>): void {
    departed.delete(id);
    live.set(id, s);
  }

  /**
   * This id has left: blank its cell so anyone holding it is notified, and
   * downgrade the store's own reference to a weak one. Returns whether the id
   * was in the roster, which is what decides if `ids` changes.
   *
   * The return value tracks MEMBERSHIP (`live.has(id)`), not whether the cell
   * happened to hold a value. Those are the same thing today, since every path
   * that promotes a cell into `live` also writes it, but conflating them made
   * this function report "nothing happened" AFTER it had already moved the cell
   * out of `live`. The id would then stay in `memberIds` forever, unreachable
   * by any later `leave` (the cell is no longer in `live` to be found), and the
   * next `upsert` for it would push a duplicate id. Deciding before mutating
   * costs nothing and takes the whole class off the table.
   */
  function blank(id: string): boolean {
    const s = live.get(id);
    if (!s) return false;
    live.delete(id);
    departed.set(id, new WeakRef(s));
    if (s.peek() !== undefined) s.value = undefined;
    return true;
  }

  /**
   * Publish a member into its cell, but only when the STATE actually changed.
   *
   * Every write here is a fresh object off the wire, so identity says nothing.
   * Without this, a reconnect snapshot (which usually carries the roster
   * unchanged) re-published every cell and woke every `member(id)` binding,
   * which is precisely the granularity this store exists to provide. The
   * comparison is one level into `state`, the same depth `useOptimistic` uses,
   * so a flat presence payload (`{ x, y }`, `{ typing }`) dedupes and a nested
   * one falls through to a write rather than risking a missed update.
   */
  function writeMember(
    cell: Signal<PresenceMember<S> | undefined>,
    next: PresenceMember<S>
  ): void {
    const prev = cell.peek();
    if (prev !== undefined && shallowEqual(prev.state, next.state)) return;
    cell.value = next;
  }

  return {
    snapshot(members) {
      batch(() => {
        // First-occurrence order, last-value wins: a snapshot carrying a
        // duplicate id collapses to one cell AND one id, so `ids` and the cell
        // maps stay in step.
        const nextIds: string[] = [];
        const present = new Set<string>();
        for (const m of members) {
          if (!present.has(m.id)) {
            present.add(m.id);
            nextIds.push(m.id);
          }
          const s = resolve(m.id);
          promote(m.id, s);
          writeMember(s, m);
        }
        // Anyone no longer listed is blanked THROUGH their existing cell, so a
        // held binding is notified instead of orphaned. Snapshotting the keys
        // first: `blank` mutates `live` as it goes.
        for (const id of [...live.keys()]) {
          if (!present.has(id)) blank(id);
        }
        // Only when membership actually changed. A reconnect snapshot usually
        // carries the SAME roster, and `memberIds` is documented as changing on
        // join/leave only; writing a fresh array unconditionally woke every
        // `memberIds` binding on every reconnect.
        if (!shallowEqual(ids.peek(), nextIds)) ids.value = nextIds;
      });
    },
    upsert(id, state) {
      const existing = live.get(id);
      if (existing) {
        // Already in the roster: touch ONLY this member's signal, never `ids`.
        // Keyed on MEMBERSHIP rather than on the cell holding a value, for the
        // same reason `blank` is: a present-but-blank cell would otherwise fall
        // through and push a SECOND copy of `id` into `ids`.
        writeMember(existing, { id, state });
        return;
      }
      batch(() => {
        const s = resolve(id);
        promote(id, s);
        s.value = { id, state };
        ids.value = [...ids.value, id];
      });
    },
    leave(id) {
      batch(() => {
        if (blank(id)) ids.value = ids.value.filter((x) => x !== id);
      });
    },
    memberIds: ids,
    members,
    member(id): ReadonlySignal<PresenceMember<S> | undefined> {
      // Deliberately does NOT promote: asking about an id says nothing about
      // whether they are in the room.
      return resolve(id);
    },
    dispose() {
      batch(() => {
        for (const s of live.values()) {
          if (s.peek() !== undefined) s.value = undefined;
        }
        for (const ref of departed.values()) {
          const s = ref.deref();
          if (s && s.peek() !== undefined) s.value = undefined;
        }
        live.clear();
        departed.clear();
        ids.value = [];
      });
    },
    retainedCellCount() {
      let n = live.size;
      for (const ref of departed.values()) {
        if (ref.deref() !== undefined) n++;
      }
      return n;
    },
  };
}
