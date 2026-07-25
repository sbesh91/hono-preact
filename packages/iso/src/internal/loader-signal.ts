import { signal, computed, batch } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { PhaseCell } from './reactive.js';
import type { StreamState, StreamStatus } from '../loader-state.js';
import { toStreamState } from '../loader-state.js';

/**
 * A phase cell mirroring one loader's projected `LoaderState`. The loader host
 * writes it each render (memoized value = no-op); `useData()` reads `source`.
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

/**
 * Fold a retained collect-mode chunk log into a `StreamState<Acc>`,
 * INCREMENTALLY: `index`/`acc` live in this closure (not inside the `computed`
 * callback), so a recompute only reduces the chunks appended since the last
 * recompute, not the whole log again. Total work across the whole stream is
 * therefore O(n), not O(n^2). Each call gets its OWN `index`/`acc`, which is
 * what lets multiple `useData(initial, reduce)` consumers reading the SAME
 * `chunks` signal fold independently (one retained log, N independent folds).
 * Called once per `useData()` invocation and memoized by the caller (a fresh
 * call would refold from an empty `index`, losing the "consume the whole
 * retained log on first read" property for a late mount, so callers must
 * create this exactly once and hold the result).
 */
export function foldStream<Acc>(
  chunks: ReadonlySignal<readonly unknown[]>,
  status: ReadonlySignal<StreamStatus>,
  error: ReadonlySignal<Error | null>,
  initial: Acc,
  reduce: (acc: Acc, chunk: unknown) => Acc
): ReadonlySignal<StreamState<Acc>> {
  let index = 0;
  let acc = initial;
  return computed(() => {
    const log = chunks.value;
    while (index < log.length) {
      acc = reduce(acc, log[index]);
      index += 1;
    }
    return toStreamState(
      status.value,
      { present: true, value: acc },
      error.value
    );
  });
}

/**
 * A live loader's collect-mode state: the retained chunk log plus
 * status/error, as WRITABLE signals. Kept here (not in `use-loader-runner.tsx`
 * / `loader.tsx`) so `@preact/signals` enters the module graph only through
 * this file and `roster-signal.ts` (`signals-always-on.test.ts` pins this
 * invariant); callers get pre-built signals and mutator functions, never a
 * raw `signal()`/`batch()` call of their own.
 */
export type CollectSignals = {
  chunks: Signal<readonly unknown[]>;
  status: Signal<StreamStatus>;
  error: Signal<Error | null>;
};

/** Fresh collect-mode signals: an empty retained log, `connecting`, no error. */
export function createCollectSignals(): CollectSignals {
  return {
    chunks: signal<readonly unknown[]>([]),
    status: signal<StreamStatus>('connecting'),
    error: signal<Error | null>(null),
  };
}

/**
 * Append one chunk to the retained log and flip status to `open`, ATOMICALLY
 * (`batch`), so a reader never observes the log grown but status still
 * `connecting` (or vice versa).
 */
export function appendCollectChunk(s: CollectSignals, chunk: unknown): void {
  batch(() => {
    s.chunks.value = [...s.chunks.value, chunk];
    s.status.value = 'open';
  });
}

/** Reset for a fresh subscription (initial mount or a reload): empty log,
 * `connecting`, no error. */
export function resetCollectSignals(s: CollectSignals): void {
  batch(() => {
    s.chunks.value = [];
    s.status.value = 'connecting';
    s.error.value = null;
  });
}

/** Record a collect-mode stream error, atomically. */
export function setCollectError(s: CollectSignals, error: Error): void {
  batch(() => {
    s.error.value = error;
    s.status.value = 'error';
  });
}

/** Mark a collect-mode stream cleanly closed (the generator/response ended). */
export function closeCollectSignals(s: CollectSignals): void {
  s.status.value = 'closed';
}
