/**
 * SPIKE (throwaway): the pluggable reactive cell from §5(B) of
 * `docs/superpowers/specs/2026-07-21-first-party-signals-design.md`.
 *
 * The loader runner writes its phase through a cell instead of straight into
 * `useState`. With no factory registered the runner keeps its existing
 * `useState` behaviour bit-for-bit and this module costs one null check. When
 * the opt-in signals module registers a factory, the phase lives in a signal
 * and the runner can hand a derived view signal outward, so a value update
 * patches bound DOM without re-rendering the component that owns the hook.
 *
 * Deliberately free of any signals import: this file must stay in core, so it
 * may not reference `@preact/signals` even in a type position.
 */

/** A minimal read-without-subscribing / write cell. */
export type Cell<T> = {
  /**
   * Read WITHOUT establishing a reactive dependency. Named `peek` to match the
   * signals vocabulary and to make accidental subscription hard to write: the
   * runner reads the phase during render, and in signal mode that read must
   * never subscribe the component (subscribing is exactly the re-render this
   * design exists to avoid).
   */
  peek(): T;
  set(next: T | ((prev: T) => T)): void;
  /**
   * The underlying reactive source, non-null only in signal mode. Typed
   * structurally (`{ readonly value: T }`) so core never names a Signal.
   */
  source: { readonly value: T } | null;
};

export type CellFactory = <T>(initial: T) => Cell<T>;

/** Build a derived, memoized read-only source. Signal mode only. */
export type DeriveFactory = <T>(compute: () => T) => { readonly value: T };

let cellFactory: CellFactory | null = null;
let deriveFactory: DeriveFactory | null = null;

/**
 * Install the signal-backed implementations. Called at import time by the
 * opt-in module. Registering after a loader has already mounted does not
 * retro-fit that loader (its cell was chosen at first render); registration is
 * expected during boot, before the first route mounts, which the deferred-
 * install spike showed is achievable without entry-closure inclusion.
 */
export function registerReactiveImpl(
  impl: { cell: CellFactory; derive: DeriveFactory } | null
): void {
  cellFactory = impl ? impl.cell : null;
  deriveFactory = impl ? impl.derive : null;
}

export function getCellFactory(): CellFactory | null {
  return cellFactory;
}

export function getDeriveFactory(): DeriveFactory | null {
  return deriveFactory;
}
