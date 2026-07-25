import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

/**
 * A settable module-store cell backed by a signal. The store module writes via
 * `set`; consumers read the `readonly` signal (directly, or through a memoized
 * `useComputed` projection). This is the sanctioned `@preact/signals` importer
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
