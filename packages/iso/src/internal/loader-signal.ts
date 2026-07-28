import { signal, computed, batch } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { StreamState, StreamStatus } from '../loader-state.js';
import { toStreamState } from '../loader-state.js';

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
  s: CollectView,
  initial: Acc,
  reduce: (acc: Acc, chunk: unknown) => Acc
): ReadonlySignal<StreamState<Acc>> {
  let index = 0;
  let acc = initial;
  let seenEpoch = s.epoch.value;
  return computed(() => {
    if (s.epoch.value !== seenEpoch) {
      index = 0;
      acc = initial;
      seenEpoch = s.epoch.value;
    }
    // `appended` is BOTH the subscription and the bound: it is the length that
    // was published atomically with the pushes that produced it, so folding to
    // it can never read past what a writer has committed, even though `log` is
    // a mutable array this fold does not own.
    const len = s.appended.value;
    while (index < len) {
      acc = reduce(acc, s.log[index]);
      index += 1;
    }
    return toStreamState(
      s.status.value,
      { present: index > 0, value: acc },
      s.error.value
    );
  });
}

/**
 * A live loader's collect-mode state: the retained chunk log plus
 * status/error, as WRITABLE signals. Kept here (not in `use-loader-runner.tsx`
 * / `loader.tsx`) because the four fields have to move ATOMICALLY: every
 * mutator below is a `batch`, and a caller writing the raw signals itself
 * would have to re-derive that pairing at each call site. Callers get
 * pre-built signals plus the mutators, so the atomicity contract has exactly
 * one implementation.
 */
export type CollectSignals = {
  /**
   * The retained chunk log: a STABLE array, appended to IN PLACE.
   *
   * It is deliberately not a signal. Copy-on-write (`[...log, chunk]` per
   * message) made the append O(n) and the stream O(n^2) overall: 20k chunks
   * spent 234 ms purely copying, and the discarded intermediate arrays are
   * their own GC load. Nothing needed those copies. `foldStream` reads the log
   * forward from its own cursor and never retains a snapshot of it, and no
   * other reader exists, so a growing array is the accurate shape.
   *
   * Readers MUST NOT mutate it, and MUST bound their reads by `appended`
   * rather than by `log.length` -- see `appended`. `CollectSignals` is
   * internal (nothing reaches it through `hono-preact/internal`), so that
   * contract is enforceable by review.
   */
  readonly log: unknown[];
  /**
   * `log.length`, as a signal: the ONLY notification channel for the log, and
   * the authoritative length a reader should fold to.
   *
   * Both roles belong to one value on purpose. A mutable array cannot notify,
   * so a separate counter has to; making that counter the fold bound too means
   * a reader can never observe a length that was not published atomically with
   * the pushes behind it, so the two cannot drift.
   */
  appended: Signal<number>;
  status: Signal<StreamStatus>;
  error: Signal<Error | null>;
  /**
   * Monotonic generation counter, bumped by `resetCollectSignals` on every
   * fresh subscription (initial mount or a reload). Lets a `foldStream` fold
   * (which retains its own `index`/`acc` closure state) detect a reset and
   * refold from scratch instead of continuing to fold onto a stale
   * accumulator. See `foldStream`'s doc comment for why this can't be
   * inferred from the log's length alone.
   */
  epoch: Signal<number>;
};

/**
 * The read side of `CollectSignals`, as `foldStream` and the loader stream
 * context consume it: everything readonly, including the log. Writers hold the
 * `CollectSignals` shape; readers only ever get this.
 */
export type CollectView = {
  readonly log: readonly unknown[];
  readonly appended: ReadonlySignal<number>;
  readonly status: ReadonlySignal<StreamStatus>;
  readonly error: ReadonlySignal<Error | null>;
  readonly epoch: ReadonlySignal<number>;
};

/** Fresh collect-mode signals: an empty retained log, `connecting`, no error,
 * epoch 0. */
export function createCollectSignals(): CollectSignals {
  return {
    log: [],
    appended: signal(0),
    status: signal<StreamStatus>('connecting'),
    error: signal<Error | null>(null),
    epoch: signal(0),
  };
}

/**
 * Append one chunk to the retained log and flip status to `open`, ATOMICALLY
 * (`batch`), so a reader never observes the log grown but status still
 * `connecting` (or vice versa).
 *
 * The push happens BEFORE `appended` is written, so the chunk is in place by
 * the time any reader can learn the length grew.
 */
export function appendCollectChunk(s: CollectSignals, chunk: unknown): void {
  s.log.push(chunk);
  batch(() => {
    s.appended.value = s.log.length;
    s.status.value = 'open';
  });
}

/** Reset for a fresh subscription (initial mount or a reload): empty log,
 * `connecting`, no error, epoch bumped so any retained `foldStream` closure
 * refolds from scratch instead of continuing onto the prior stream's
 * accumulator (see `foldStream`'s doc comment). */
export function resetCollectSignals(s: CollectSignals): void {
  // Truncate in place: the array identity is the one thing every reader holds,
  // so it has to survive a reset. Emptied before `appended` is published, for
  // the same ordering reason the append pushes first.
  s.log.length = 0;
  batch(() => {
    s.appended.value = 0;
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
