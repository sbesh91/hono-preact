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
 * `chunks` array fold independently (one retained log, N independent folds).
 * Called once per `useData()` invocation and memoized by the caller (a fresh
 * call would refold from an empty `index`, losing the "consume the whole
 * retained log on first read" property for a late mount, so callers must
 * create this exactly once and hold the result).
 *
 * `epoch` is a monotonic generation counter that `appendCollectChunk` bumps
 * every time it empties `chunks` (the first chunk after a resubscribe). Without it, this
 * closure's `index`/`acc` would stay stale across a reset (the old `index`
 * pointing past the new, shorter log, and `acc` still carrying the PRIOR
 * stream's total), silently dropping the new stream's early chunks and
 * corrupting the fold. Each recompute compares `epoch.value` against the last
 * epoch it observed (`seenEpoch`) and, on a mismatch, resets `index`/`acc`
 * BEFORE folding, so a resumed stream folds strictly from scratch. This is
 * checked as an explicit counter rather than inferred from `chunks.length <
 * index`: signal writes inside the truncating append's `batch` coalesce into
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
    // it can never read past what a writer has committed, even though `chunks` is
    // a mutable array this fold does not own.
    const len = s.appended.value;
    while (index < len) {
      acc = reduce(acc, s.chunks[index]);
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
   * It is deliberately not a signal. Copy-on-write (`[...chunks, chunk]` per
   * message) made the append O(n) and the stream O(n^2) overall: 20k chunks
   * spent 234 ms purely copying, and the discarded intermediate arrays are
   * their own GC load. Nothing needed those copies. `foldStream` reads the log
   * forward from its own cursor and never retains a snapshot of it, and no
   * other reader exists, so a growing array is the accurate shape.
   *
   * Readers MUST NOT mutate it, and MUST bound their reads by `appended`
   * rather than by `chunks.length` -- see `appended`. `CollectSignals` is
   * internal (nothing reaches it through `hono-preact/internal`), so that
   * contract is enforceable by review.
   */
  readonly chunks: unknown[];
  /**
   * `chunks.length`, as a signal: the ONLY notification channel for the log, and
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
   * Monotonic generation counter, bumped by the truncating append on the first
   * chunk of a fresh subscription. Lets a `foldStream` fold
   * (which retains its own `index`/`acc` closure state) detect a reset and
   * refold from scratch instead of continuing to fold onto a stale
   * accumulator. See `foldStream`'s doc comment for why this can't be
   * inferred from the log's length alone.
   */
  epoch: Signal<number>;
  /**
   * Set while a resubscribe is in flight, cleared by the first chunk that
   * arrives on the new connection (see `beginCollectResubscribe`). A plain
   * field, not a signal: nothing renders from it, it only decides what the
   * next append does.
   */
  pendingTruncate: boolean;
};

/**
 * The read side of `CollectSignals`, as `foldStream` and the loader stream
 * context consume it: everything readonly, including the log. Writers hold the
 * `CollectSignals` shape; readers only ever get this.
 */
export type CollectView = {
  readonly chunks: readonly unknown[];
  readonly appended: ReadonlySignal<number>;
  readonly status: ReadonlySignal<StreamStatus>;
  readonly error: ReadonlySignal<Error | null>;
  readonly epoch: ReadonlySignal<number>;
};

/** Fresh collect-mode signals: an empty retained log, `connecting`, no error,
 * epoch 0. */
export function createCollectSignals(): CollectSignals {
  return {
    chunks: [],
    appended: signal(0),
    pendingTruncate: false,
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
  if (s.pendingTruncate) {
    // First chunk of a new subscription: NOW discard the prior connection's
    // chunks, not when the resubscribe started. Truncating up front meant a
    // reconnect that never delivered had already destroyed the data it was
    // replacing, so a failed reconnect took the user's fold down with it.
    // Deferring it here is what makes a collect stream stale-while-revalidate,
    // matching what fold-mode's phase already did.
    s.pendingTruncate = false;
    s.chunks.length = 0;
    s.chunks.push(chunk);
    batch(() => {
      s.appended.value = 1;
      // Bump the generation so every retained fold refolds from scratch rather
      // than continuing onto the prior stream's accumulator.
      s.epoch.value = s.epoch.value + 1;
      s.status.value = 'open';
    });
    return;
  }
  s.chunks.push(chunk);
  batch(() => {
    s.appended.value = s.chunks.length;
    s.status.value = 'open';
  });
}

/**
 * Begin a (re)subscription: report `connecting`, clear any prior error, and ARM
 * the truncate rather than performing it.
 *
 * The retained chunks stay readable until the new connection delivers its first
 * chunk, so a consumer keeps folding the last good stream while the reconnect
 * is in flight, and keeps it if the reconnect fails outright. `appendCollectChunk`
 * performs the truncate (and bumps the epoch) when that first chunk lands.
 */
export function beginCollectResubscribe(s: CollectSignals): void {
  s.pendingTruncate = true;
  batch(() => {
    s.error.value = null;
    // Report `connecting` ONLY when there is nothing to keep showing. With
    // chunks retained, `connecting` would blank the data arm (it is the
    // pre-first-chunk status, so `toStreamState` carries no value on it) and
    // the fold would vanish for the length of the reconnect, then reappear if
    // the reconnect failed -- worse than either outcome.
    //
    // Leaving the status alone is the same structural rule fold-mode already
    // follows one level up: `loader-reload.ts` moves the phase to
    // `revalidating` (which RETAINS the value) when one is present and
    // `loading` only when none is. Presence decides, in both modes.
    if (s.appended.value === 0) s.status.value = 'connecting';
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
