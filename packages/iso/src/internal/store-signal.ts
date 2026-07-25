import { signal, useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

/**
 * A settable module-store cell backed by a signal. The store module writes via
 * `set`; consumers read the `readonly` signal (directly, or through a
 * `useStoreValue` projection). This is the sanctioned `@preact/signals` importer
 * for the action / form / optimistic stores, so those store modules stay free
 * of a direct `@preact/signals` value import (the module-graph guard).
 */
export type StoreSignal<T> = {
  readonly signal: ReadonlySignal<T>;
  set(value: T): void;
};

export function createStoreSignal<T>(initial: T): StoreSignal<T> {
  const s = signal<T>(initial);
  return {
    signal: s,
    set(value: T) {
      s.value = value;
    },
  };
}

/**
 * A component-scoped reactive projection of store signals: read any store
 * `.value`s inside `project` and this returns a `ReadonlySignal<R>` that a
 * binding tracks, so a consumer updates on a store change without the host
 * re-rendering. Routing store reads through this keeps the consumer hooks
 * (`useActionResult`, `useFormStatus`, ...) free of a direct `@preact/signals`
 * value import, so `@preact/signals` stays confined to the factory modules.
 */
export function useStoreValue<R>(project: () => R): ReadonlySignal<R> {
  return useComputed(project);
}

/**
 * A component-scoped (not module-level) settable signal: `useSignal` creates
 * it once for the component instance and persists it across renders. This is
 * the per-call-site counterpart to `createStoreSignal`'s module-level store,
 * for hooks that need a mutable signal cell scoped to one hook call (e.g.
 * `useOptimistic`'s queue) without importing `@preact/signals` directly.
 */
export function useStoreState<T>(initial: T): {
  readonly value: ReadonlySignal<T>;
  set(next: T): void;
} {
  const s = useSignal(initial);
  return {
    value: s,
    set(next: T) {
      s.value = next;
    },
  };
}
