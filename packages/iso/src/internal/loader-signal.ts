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
 *
 * `epoch` is a monotonic generation counter that `resetCollectSignals` bumps
 * every time it empties `chunks` (a reload / resubscribe). Without it, this
 * closure's `index`/`acc` would stay stale across a reset (the old `index`
 * pointing past the new, shorter log, and `acc` still carrying the PRIOR
 * stream's total), silently dropping the new stream's early chunks and
 * corrupting the fold. Each recompute compares `epoch.value` against the last
 * epoch it observed (`seenEpoch`) and, on a mismatch, resets `index`/`acc`
 * BEFORE folding, so a resumed stream folds strictly from scratch. This is
 * checked as an explicit counter rather than inferred from `log.length <
 * index`: signal writes inside `resetCollectSignals`'s `batch` coalesce into
 * one recompute, so a reset immediately followed by an append can be observed
 * as a single change with a log whose length is no shorter than before,
 * which a length-based heuristic would miss.
 *
 * Value-presence is likewise structural: `present` is `index > 0` (AFTER the
 * epoch-reset check), i.e. whether this epoch has folded any chunk yet. A
 * stream that errors before its first chunk therefore reports `present:
 * false` (no fabricated `initial` masquerading as real data), matching the
 * fold-mode path's pre-first-chunk contract in `loader-state.ts`.
 */
export function foldStream<Acc>(
  chunks: ReadonlySignal<readonly unknown[]>,
  status: ReadonlySignal<StreamStatus>,
  error: ReadonlySignal<Error | null>,
  epoch: ReadonlySignal<number>,
  initial: Acc,
  reduce: (acc: Acc, chunk: unknown) => Acc
): ReadonlySignal<StreamState<Acc>> {
  let index = 0;
  let acc = initial;
  let seenEpoch = epoch.value;
  return computed(() => {
    if (epoch.value !== seenEpoch) {
      index = 0;
      acc = initial;
      seenEpoch = epoch.value;
    }
    const log = chunks.value;
    while (index < log.length) {
      acc = reduce(acc, log[index]);
      index += 1;
    }
    return toStreamState(
      status.value,
      { present: index > 0, value: acc },
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
  /**
   * Monotonic generation counter, bumped by `resetCollectSignals` on every
   * fresh subscription (initial mount or a reload). Lets a `foldStream` fold
   * (which retains its own `index`/`acc` closure state) detect a reset and
   * refold from scratch instead of continuing to fold onto a stale
   * accumulator. See `foldStream`'s doc comment for why this can't be
   * inferred from `chunks.length` alone.
   */
  epoch: Signal<number>;
};

/** Fresh collect-mode signals: an empty retained log, `connecting`, no error,
 * epoch 0. */
export function createCollectSignals(): CollectSignals {
  return {
    chunks: signal<readonly unknown[]>([]),
    status: signal<StreamStatus>('connecting'),
    error: signal<Error | null>(null),
    epoch: signal(0),
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
 * `connecting`, no error, epoch bumped so any retained `foldStream` closure
 * refolds from scratch instead of continuing onto the prior stream's
 * accumulator (see `foldStream`'s doc comment). */
export function resetCollectSignals(s: CollectSignals): void {
  batch(() => {
    s.chunks.value = [];
    s.status.value = 'connecting';
    s.error.value = null;
    s.epoch.value = s.epoch.value + 1;
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
