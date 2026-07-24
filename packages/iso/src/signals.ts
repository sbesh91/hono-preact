import { signal, computed, type Signal } from '@preact/signals';
import type { PresenceMember } from './internal/room-envelope.js';
import {
  registerPresenceReactiveImpl,
  registerLoaderReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
  type PhaseCell,
} from './internal/reactive.js';

/**
 * The opt-in signals entry (the `hono-preact/signals` subpath). Importing this
 * module installs the signal-backed roster: `member(id)` becomes a per-member
 * signal, so a presence update patches one bound row instead of re-rendering
 * every consumer. This is the ONLY module that imports `@preact/signals`; apps
 * that never import it pay no signal bytes.
 */
function createSignalRoster<S>(): RosterStore<S> {
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
    member(id): ReadonlyReactive<PresenceMember<S> | undefined> {
      return byId.get(id) ?? absent;
    },
    dispose() {
      byId.clear();
      ids.value = [];
    },
  };
}

/** Register the signal-backed roster. Called on import; exported so a test can
 * re-install after clearing the registration. */
export function installPresenceSignals(): void {
  registerPresenceReactiveImpl({
    createRoster: <S>() => createSignalRoster<S>(),
  });
}

/**
 * The signal-backed loader implementation: `createPhaseCell` is a `Signal`, and
 * `derive` is a `computed`. Reading a derived signal in a component subscribes
 * that component, so a `useFieldSignal` node updates alone when its field
 * changes, without the loader host re-rendering it.
 */
export function installLoaderSignals(): void {
  registerLoaderReactiveImpl({
    createPhaseCell: <T,>(initial: T): PhaseCell<T> => {
      const s = signal(initial);
      return {
        set(value) {
          s.value = value;
        },
        source: s,
      };
    },
    derive: <T, R>(source: ReadonlyReactive<T>, select: (v: T) => R) =>
      computed(() => select(source.value)),
  });
}

installPresenceSignals();
installLoaderSignals();
