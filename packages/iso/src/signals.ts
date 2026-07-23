import { signal, computed, type Signal } from '@preact/signals';
import type { PresenceMember } from './internal/room-envelope.js';
import {
  registerPresenceReactiveImpl,
  type ReadonlyReactive,
  type RosterStore,
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

  return {
    snapshot(members) {
      byId.clear();
      for (const m of members) byId.set(m.id, signal(m));
      ids.value = members.map((m) => m.id);
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

installPresenceSignals();
