import type { PresenceMember } from './room-envelope.js';

/**
 * A value that can be read reactively. Core names this shape WITHOUT importing
 * `@preact/signals`, so the dependency stays opt-in. A `Signal` satisfies it
 * structurally; the signals-free default satisfies it with a getter.
 */
export type ReadonlyReactive<T> = { readonly value: T };

/**
 * The internal contract for a room's roster, satisfied by both the signals-free
 * default and the opt-in signal-backed implementation. `useRoom` drives it with
 * the same wire deltas it applies to its `members` array; the granular reads
 * (`memberIds` / `member`) are exposed on the hook result.
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
  readonly memberIds: ReadonlyReactive<readonly string[]>;
  /** The whole roster as one reactive array. Reading it in signal mode
   * subscribes to every member, so a coarse `members` consumer updates on any
   * change; `useRoom` exposes it as the `members` result field in signal mode. */
  readonly members: ReadonlyReactive<ReadonlyArray<PresenceMember<S>>>;
  /** One member's entry; in signal mode, changes only when THAT member changes. */
  member(id: string): ReadonlyReactive<PresenceMember<S> | undefined>;
  /** Release retained reactive state. Called from `useRoom`'s effect cleanup. */
  dispose(): void;
};

/** Factory for the granular store, registered by the opt-in signals entry. */
export type PresenceReactiveImpl = {
  createRoster<S>(): RosterStore<S>;
};

let presenceImpl: PresenceReactiveImpl | null = null;

/** Install (or clear, with `null`) the signal-backed roster implementation. */
export function registerPresenceReactiveImpl(
  impl: PresenceReactiveImpl | null
): void {
  presenceImpl = impl;
}

/** The registered implementation, or null when the signals entry is unused. */
export function getPresenceReactiveImpl(): PresenceReactiveImpl | null {
  return presenceImpl;
}

/**
 * A settable reactive cell mirroring one loader's projected `LoaderState`. The
 * loader host writes it each render (with the memoized state, so an unchanged
 * value is a no-op); `useDataSignal` reads `source`. Signal-backed in signal
 * mode; unused in default mode (the host falls back to a context snapshot).
 */
export type PhaseCell<T> = {
  set(value: T): void;
  readonly source: ReadonlyReactive<T>;
};

/** Factory for the loader signal machinery, registered by the signals entry. */
export type LoaderReactiveImpl = {
  createPhaseCell<T>(initial: T): PhaseCell<T>;
  /** A memoized projection off a reactive source (a `computed` in signal mode). */
  derive<T, R>(
    source: ReadonlyReactive<T>,
    select: (v: T) => R
  ): ReadonlyReactive<R>;
};

let loaderImpl: LoaderReactiveImpl | null = null;

/** Install (or clear, with `null`) the signal-backed loader implementation. */
export function registerLoaderReactiveImpl(
  impl: LoaderReactiveImpl | null
): void {
  loaderImpl = impl;
}

/** The registered loader implementation, or null when the signals entry is unused. */
export function getLoaderReactiveImpl(): LoaderReactiveImpl | null {
  return loaderImpl;
}
