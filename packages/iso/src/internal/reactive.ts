import type { ReadonlySignal } from '@preact/signals';
import type { PresenceMember } from './room-envelope.js';

/**
 * The internal contract for a room's roster, backed by the signal-based
 * implementation in `roster-signal.ts`. `useRoom` drives it with the same wire
 * deltas it applies to its `members` array; the granular reads (`memberIds` /
 * `member`) are exposed on the hook result.
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
};

/**
 * A settable reactive cell mirroring one loader's projected `LoaderState`. The
 * loader host writes it each render (with the memoized state, so an unchanged
 * value is a no-op); `useData()` reads `source`.
 */
export type PhaseCell<T> = {
  set(value: T): void;
  readonly source: ReadonlySignal<T>;
};
