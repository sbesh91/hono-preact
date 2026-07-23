import type { PresenceMember } from './room-envelope.js';
import type { ReadonlyReactive, RosterStore } from './reactive.js';

/**
 * The signals-free roster store. The roster data already lives in `useRoom`'s
 * `useState` array; this reads through a getter to it, so the delta methods are
 * no-ops. Reads do not subscribe, so a consumer re-renders coarsely through its
 * parent (which re-rendered when `setMembers` fired), the same granularity as
 * today. Zero new bytes; `@preact/signals` is never imported on this path.
 *
 * This exists so `room.memberIds` / `room.member(id)` are always present on the
 * result and return correct values whether or not the signals entry is
 * imported; importing it upgrades the same reads to granular signals.
 */
export function createDefaultRoster<S>(
  getMembers: () => ReadonlyArray<PresenceMember<S>>
): RosterStore<S> {
  const memberIds: ReadonlyReactive<readonly string[]> = {
    get value() {
      return getMembers().map((m) => m.id);
    },
  };

  const members: ReadonlyReactive<ReadonlyArray<PresenceMember<S>>> = {
    get value() {
      return getMembers();
    },
  };

  const member = (
    id: string
  ): ReadonlyReactive<PresenceMember<S> | undefined> => ({
    get value() {
      return getMembers().find((m) => m.id === id);
    },
  });

  return {
    snapshot() {},
    upsert() {},
    leave() {},
    memberIds,
    members,
    member,
    dispose() {},
  };
}
