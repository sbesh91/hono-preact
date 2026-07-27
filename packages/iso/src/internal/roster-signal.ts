import { signal, computed, batch, type Signal } from '@preact/signals';
import type { PresenceMember } from './room-envelope.js';
import type { RosterStore } from './reactive.js';
import type { ReadonlySignal } from '@preact/signals';

/**
 * The signal-backed roster: `member(id)` is a per-member signal, so a presence
 * update patches one bound row instead of re-rendering every consumer. This is
 * the always-on data-layer store for `useRoom`; `@preact/signals` loads with it.
 */
// RETENTION: `byId` holds one cell per id ever seen OR ever asked about, and
// only `dispose()` clears it. `leave` and `snapshot` blank a cell rather than
// deleting it, and `member(id)` get-or-creates on READ, both deliberately: a
// held binding has to survive its member leaving and rejoining, and deleting
// the cell is what made a departed member render forever.
//
// The trade is that a long-lived room with high id churn grows this map for the
// life of the hook instance. Unlike `createFieldErrorStore`, whose key space is
// one form's fields, a presence roster's key space is unbounded. Acceptable
// because the map holds one small signal per id and a room's membership is
// bounded in practice, but it is a trade, not a free win. `dispose()` on the
// hook's effect cleanup is what bounds it across mounts.
export function createSignalRoster<S>(): RosterStore<S> {
  const ids = signal<readonly string[]>([]);
  // One STABLE cell per id ever asked about. Absence is `undefined` IN the
  // cell, never a missing map entry: a consumer may hold `member(id)` across
  // any roster mutation, so leave/snapshot must WRITE the cell rather than drop
  // it (same policy, and same reasoning, as `createFieldErrorStore`).
  const byId = new Map<string, Signal<PresenceMember<S> | undefined>>();
  // The whole roster as one derived array. Reading it subscribes to `ids` AND
  // every member signal, so a coarse `members` consumer updates on any change.
  // A granular consumer reads `member(id)` instead and updates per member.
  const members = computed<ReadonlyArray<PresenceMember<S>>>(() => {
    const out: PresenceMember<S>[] = [];
    for (const id of ids.value) {
      const v = byId.get(id)?.value;
      if (v !== undefined) out.push(v);
    }
    return out;
  });

  function cell(id: string): Signal<PresenceMember<S> | undefined> {
    let s = byId.get(id);
    if (!s) {
      s = signal<PresenceMember<S> | undefined>(undefined);
      byId.set(id, s);
    }
    return s;
  }

  return {
    snapshot(members) {
      batch(() => {
        // First-occurrence order, last-value wins: a snapshot carrying a
        // duplicate id collapses to one cell AND one id, so `ids` and `byId`
        // stay in step.
        const nextIds: string[] = [];
        const present = new Set<string>();
        for (const m of members) {
          if (!present.has(m.id)) {
            present.add(m.id);
            nextIds.push(m.id);
          }
          cell(m.id).value = m;
        }
        // Anyone no longer listed is blanked THROUGH their existing cell, so a
        // held binding is notified instead of orphaned.
        for (const [id, s] of byId) {
          if (!present.has(id) && s.peek() !== undefined) s.value = undefined;
        }
        ids.value = nextIds;
      });
    },
    upsert(id, state) {
      const existing = byId.get(id);
      if (existing && existing.peek() !== undefined) {
        // Existing member: touch ONLY this member's signal, never `ids`.
        existing.value = { id, state };
        return;
      }
      batch(() => {
        cell(id).value = { id, state };
        ids.value = [...ids.value, id];
      });
    },
    leave(id) {
      const s = byId.get(id);
      if (s && s.peek() !== undefined) {
        batch(() => {
          s.value = undefined;
          ids.value = ids.value.filter((x) => x !== id);
        });
      }
    },
    memberIds: ids,
    members,
    member(id): ReadonlySignal<PresenceMember<S> | undefined> {
      return cell(id);
    },
    dispose() {
      batch(() => {
        for (const s of byId.values()) {
          if (s.peek() !== undefined) s.value = undefined;
        }
        byId.clear();
        ids.value = [];
      });
    },
  };
}
