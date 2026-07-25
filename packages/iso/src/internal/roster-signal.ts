import { signal, computed, type Signal } from '@preact/signals';
import type { PresenceMember } from './room-envelope.js';
import type { RosterStore } from './reactive.js';
import type { ReadonlySignal } from '@preact/signals';

/**
 * The signal-backed roster: `member(id)` is a per-member signal, so a presence
 * update patches one bound row instead of re-rendering every consumer. This is
 * the always-on data-layer store for `useRoom`; `@preact/signals` loads with it.
 */
export function createSignalRoster<S>(): RosterStore<S> {
  const ids = signal<readonly string[]>([]);
  const byId = new Map<string, Signal<PresenceMember<S>>>();
  // A single stable reactive for any id not currently present. The keyed-list
  // consumption pattern only ever calls `member(id)` for ids in `memberIds`, so
  // this is a correctness fallback, not a hot path.
  const absent = computed<PresenceMember<S> | undefined>(() => undefined);
  // The whole roster as one derived array. Reading it subscribes to `ids` AND
  // every member signal, so a coarse `members` consumer updates on any change.
  // A granular consumer reads `member(id)` instead and updates per member.
  const members = computed<ReadonlyArray<PresenceMember<S>>>(() => {
    const out: PresenceMember<S>[] = [];
    for (const id of ids.value) {
      const s = byId.get(id);
      if (s) out.push(s.value);
    }
    return out;
  });

  return {
    snapshot(members) {
      byId.clear();
      // `[...byId.keys()]` dedupes: a snapshot carrying a duplicate id collapses
      // to one signal (last wins) AND one id, so `ids` and `byId` stay in step.
      for (const m of members) byId.set(m.id, signal(m));
      ids.value = [...byId.keys()];
    },
    upsert(id, state) {
      const existing = byId.get(id);
      if (existing) {
        // Existing member: touch ONLY this member's signal, never `ids`.
        existing.value = { id, state };
        return;
      }
      byId.set(id, signal({ id, state }));
      ids.value = [...ids.value, id];
    },
    leave(id) {
      if (byId.delete(id)) {
        ids.value = ids.value.filter((x) => x !== id);
      }
    },
    memberIds: ids,
    members,
    member(id): ReadonlySignal<PresenceMember<S> | undefined> {
      return byId.get(id) ?? absent;
    },
    dispose() {
      byId.clear();
      ids.value = [];
    },
  };
}
