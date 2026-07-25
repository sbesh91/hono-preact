import { signal, computed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { PhaseCell } from './reactive.js';

/**
 * A phase cell mirroring one loader's projected `LoaderState`. The loader host
 * writes it each render (memoized value = no-op); `useDataSignal` reads `source`.
 * The always-on data-layer implementation for loaders.
 */
export function createPhaseCell<T>(initial: T): PhaseCell<T> {
  const s = signal(initial);
  return {
    set(value) {
      s.value = value;
    },
    source: s,
  };
}

/** A memoized projection off a reactive source (a `computed`). */
export function derive<T, R>(
  source: ReadonlySignal<T>,
  select: (v: T) => R
): ReadonlySignal<R> {
  return computed(() => select(source.value));
}
