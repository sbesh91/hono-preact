import { signal, computed } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { StreamState, StreamStatus } from '../loader-state.js';
import { toStreamState } from '../loader-state.js';
import { retainEquivalent } from './publish.js';

/**
 * One collect-mode subscription, as a single immutable record.
 *
 * Everything a `useData(initial, reduce)` consumer observes lives here, so the
 * whole state moves in ONE signal write and is atomic by construction. There is
 * nothing to `batch`, and no way to publish a half-applied change: a reader
 * either sees the previous run or the next one.
 *
 * A GENERATION is the `chunks` array's identity. Appends push into the same
 * array; a fresh subscription mints a NEW one. That is the whole mechanism, and
 * it is why "truncate the log without starting a new generation" cannot be
 * expressed: truncation IS a new array. The retained-fold reset that used to
 * need a separate `epoch` counter (plus a paragraph explaining why a
 * length-based heuristic could not replace it) is now `chunks !== seenChunks`.
 */
export type CollectRun = {
  /**
   * This run's retained chunks. Appended IN PLACE: copy-on-write per message
   * made the append O(n) and the stream O(n^2) (20k chunks spent 234 ms purely
   * copying). `foldStream` reads forward from its own cursor and never retains
   * a snapshot, and no other reader exists, so a growing array is the accurate
   * shape. Readers must not mutate it, and must bound their reads by `length`
   * below rather than by `chunks.length`.
   */
  readonly chunks: unknown[];
  /**
   * How much of `chunks` this run has PUBLISHED. Not the same as
   * `chunks.length`: the array is mutated before the record is swapped in, so
   * bounding a fold by this is what guarantees a reader never reads past what a
   * writer committed.
   */
  readonly length: number;
  readonly status: StreamStatus;
  readonly error: Error | null;
  /**
   * A resubscribe is in flight and its first chunk has not landed. While set,
   * the PREVIOUS run's chunks are still being served, so a consumer keeps
   * folding the last good stream during the reconnect, and keeps it if the
   * reconnect fails. The first chunk clears this by minting a new generation.
   */
  readonly awaitingFirstChunk: boolean;
};

/**
 * A live loader's collect-mode state. One signal, because the fields have to
 * move together and a single immutable record is how that is guaranteed rather
 * than remembered. Callers get the signal plus the mutators below, so the
 * transition rules have exactly one implementation.
 */
export type CollectSignals = { readonly run: Signal<CollectRun> };

/** The read side: the same run, without the ability to write it. */
export type CollectView = { readonly run: ReadonlySignal<CollectRun> };

/** A fresh subscription: no chunks, `connecting`, no error. */
export function createCollectSignals(): CollectSignals {
  return {
    run: signal<CollectRun>({
      chunks: [],
      length: 0,
      status: 'connecting',
      error: null,
      awaitingFirstChunk: false,
    }),
  };
}

/** A value a reducer could mutate in place. Written as a predicate rather than
 * a cast so the narrowing carries into the fingerprint helpers. Arrays satisfy
 * it too: an array's own keys are its indices. */
function isMutableContainer(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A shallow content fingerprint: own keys, in order, and their values. */
type Fingerprint = {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
};

function fingerprintOf(v: Record<string, unknown>): Fingerprint {
  const keys = Object.keys(v);
  return { keys, values: keys.map((k) => v[k]) };
}

function hasMutated(v: Record<string, unknown>, f: Fingerprint): boolean {
  const keys = Object.keys(v);
  if (keys.length !== f.keys.length) return true;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== f.keys[i] || v[keys[i]] !== f.values[i]) return true;
  }
  return false;
}

export type AccumulatorGuard = {
  /** Call immediately AFTER `reduce`, passing the accumulator that was handed
   * TO it. Throws when the reducer mutated the caller's `initial`. */
  check(handedToReduce: unknown): void;
};

/**
 * Rejects a reducer that mutates the caller's `initial` in place.
 *
 * Both fold engines reset with `acc = initial` on a resubscribe, so a reducer
 * that fills `initial` makes that reset restore an object already holding the
 * previous stream: the next stream folds onto the last one and history
 * duplicates on every reconnect, growing without bound.
 *
 * **Why a fingerprint and not identity.** Asking whether `reduce` returned the
 * object it was handed flags a mutating reducer, but it equally flags an
 * ordinary FILTERING one:
 *
 *     (acc, ev) => ev.type === 'tick' ? [...acc, ev] : acc
 *
 * whose first chunk is a heartbeat. It returns `acc` untouched, which is
 * correct and common, and an identity check throws at it. Identity cannot
 * separate the two; only whether `initial` still holds what it held can.
 * So the check compares `initial` against a fingerprint taken before any fold.
 *
 * That is also strictly stronger: it catches a reducer that mutates `initial`
 * and returns a COPY (`acc.push(c); return [...acc]`), which the identity check
 * missed entirely.
 *
 * Scoped to the window where `reduce` is actually handed `initial`, which is
 * the aliasing hazard: once the accumulator diverges, the reducer no longer has
 * `initial` to corrupt unless it captured it separately, which is out of scope.
 * Cost is O(own keys of `initial`) per chunk in that window, and `initial` is
 * `[]` or `{}` in every documented use, so in practice O(1) on the first chunk.
 *
 * A primitive `initial` cannot be corrupted this way, so it is never guarded and
 * `(acc) => acc` over a number stays legal.
 */
export function createAccumulatorGuard(
  initial: unknown,
  host: AccumulatorHost
): AccumulatorGuard {
  const container = isMutableContainer(initial) ? initial : null;
  const before = container === null ? null : fingerprintOf(container);
  return {
    check(handedToReduce) {
      if (container === null || before === null) return;
      if (handedToReduce !== initial) return;
      if (hasMutated(container, before)) throw new Error(mutationMessage(host));
    },
  };
}

/** Which engine is reporting, so the message names the host the caller used. */
export type AccumulatorHost = 'live' | 'accumulating';

/**
 * The explanation is DEV/SSR-only (#338): a production client build gets the
 * one-line diagnosis, since the fix is for whoever is building the app and
 * shipping the prose costs every visitor bytes on a loader path.
 *
 * The long strings live HERE rather than at the two call sites, which pass a
 * short discriminant instead. Passing the message as an argument would keep it
 * referenced at the call site no matter what the gate resolves to, so it would
 * never tree-shake, which is exactly the trap `use-entry.ts` documents.
 */
function mutationMessage(host: AccumulatorHost): string {
  const subject = host === 'live' ? 'A live loader' : 'An accumulating loader';
  return typeof import.meta.env === 'undefined' ||
    import.meta.env.SSR ||
    import.meta.env.DEV
    ? `${subject} \`reduce\` must not mutate its accumulator: this one ` +
        'modified `initial` in place. The fold restarts from `initial` on a ' +
        'reconnect, so the previous stream would carry into the next one and ' +
        'duplicate it. Return a new accumulator instead (`[...acc, chunk]`, ' +
        '`{ ...acc }`).'
    : `${subject} \`reduce\` must not mutate its accumulator.`;
}

/**
 * Structural equality over the three fields a `StreamState` can carry.
 *
 * `toStreamState` is a pure constructor: it builds a fresh object every call,
 * which is correct for a constructor and fatal for a `computed`, whose only
 * dedupe is `===` on the produced value. Without this, a fold emits a new
 * object identity on every chunk and wakes every consumer even when nothing
 * they can read has changed. Comparing here rather than memoizing inside
 * `toStreamState` keeps the constructor pure for its other callers.
 */
function sameStreamState<T>(a: StreamState<T>, b: StreamState<T>): boolean {
  if (a.status !== b.status) return false;
  // `data` is uniformly readable on the bare union (cold arms declare
  // `data?: never`), so this needs no narrow.
  if (a.data !== b.data) return false;
  // The re-test of `b` is what narrows it for the compiler; `a.status ===
  // b.status` above already guarantees it.
  if (a.status === 'error') return b.status === 'error' && a.error === b.error;
  return true;
}

/**
 * Fold a run's retained chunks into a `StreamState<Acc>`, INCREMENTALLY:
 * `index`/`acc` live in this closure rather than inside the `computed`, so a
 * recompute reduces only the chunks appended since the last one. Total work
 * across a stream is O(n), not O(n^2). Each call gets its own cursor, which is
 * what lets several `useData(initial, reduce)` consumers fold the SAME retained
 * chunks independently.
 *
 * Called once per `useData()` invocation and memoized by the caller: a fresh
 * call would refold from an empty cursor, losing the "a late mount consumes the
 * whole retained log" property that the retention exists for.
 *
 * A generation change is detected by the chunks array's IDENTITY. A new
 * subscription mints a new array, so the cursor and accumulator reset before
 * folding and a resumed stream folds strictly from scratch instead of
 * continuing onto the prior stream's total. Identity cannot drift the way the
 * counter it replaced could, and unlike a `length < index` heuristic it is not
 * fooled by a truncation that lands in the same update as an append.
 *
 * Value-presence is structural: `present` is `index > 0` (AFTER the generation
 * check), i.e. whether THIS generation has folded anything. A stream that
 * errors before its first chunk reports `present: false` rather than a
 * fabricated `initial` masquerading as real data, matching the fold-mode
 * contract in `loader-state.ts`.
 */
export function foldStream<Acc>(
  s: CollectView,
  initial: Acc,
  reduce: (acc: Acc, chunk: unknown) => Acc
): ReadonlySignal<StreamState<Acc>> {
  let index = 0;
  let acc = initial;
  let seenChunks: readonly unknown[] | null = null;
  // Republish the SAME object when the fold produced an equivalent state, so
  // `computed` can dedupe it. A filtering `reduce` is the case that needs it:
  // `(acc, ev) => ev.type === 'tick' ? [...acc, ev] : acc` returns `acc`
  // untouched on a heartbeat, so there is nothing new to show, and without this
  // every consumer re-rendered on every heartbeat anyway.
  const retain = retainEquivalent<StreamState<Acc>>(sameStreamState);
  const guard = createAccumulatorGuard(initial, 'live');
  return computed(() => {
    const run = s.run.value;
    if (run.chunks !== seenChunks) {
      index = 0;
      acc = initial;
      seenChunks = run.chunks;
    }
    while (index < run.length) {
      const handed = acc;
      const next = reduce(acc, run.chunks[index]);
      guard.check(handed);
      acc = next;
      index += 1;
    }
    const state = toStreamState(
      run.status,
      { present: index > 0, value: acc },
      run.error
    );
    return retain(state);
  });
}

/**
 * Append one chunk and report the stream `open`.
 *
 * The first chunk after a resubscribe starts a NEW generation: a new array, so
 * every retained fold resets its cursor. That is deferred to here, rather than
 * done when the resubscribe began, because truncating up front destroyed the
 * data the reconnect was replacing before finding out whether it could replace
 * it -- a failed reconnect took the user's fold with it.
 */
export function appendCollectChunk(s: CollectSignals, chunk: unknown): void {
  const run = s.run.peek();
  if (run.awaitingFirstChunk) {
    s.run.value = {
      chunks: [chunk],
      length: 1,
      status: 'open',
      error: null,
      awaitingFirstChunk: false,
    };
    return;
  }
  // In place, then publish: the chunk is present before any reader can learn
  // the length grew.
  run.chunks.push(chunk);
  s.run.value = { ...run, length: run.chunks.length, status: 'open' };
}

/**
 * Begin a (re)subscription: clear any prior error and mark that the next chunk
 * starts a new generation. The current run's chunks stay served until it does.
 */
/**
 * Drop everything and start over: a NEW target, not a reconnect to the old one.
 *
 * The distinction is the whole reason this exists next to
 * `beginCollectResubscribe`. Retaining chunks across a RECONNECT is correct and
 * deliberate (a failed reconnect must not take the user's fold with it). Doing
 * the same across a NAVIGATION is not: `/stock/AAPL` -> `/stock/MSFT` would keep
 * serving AAPL's chunks, labelled `reconnecting`, until MSFT's first chunk
 * lands, which for a quiet stream is indefinitely. Fold-mode never had this
 * because `subscribeFold` reseeds `session.acc = mode.initial` on every
 * subscribe; the two streaming modes simply disagreed.
 *
 * A fresh `chunks` array is what resets every retained fold's cursor, the same
 * generation mechanism the first chunk of a reconnect uses.
 */
export function resetCollectRun(s: CollectSignals): void {
  s.run.value = {
    chunks: [],
    length: 0,
    status: 'connecting',
    error: null,
    awaitingFirstChunk: false,
  };
}

export function beginCollectResubscribe(s: CollectSignals): void {
  const run = s.run.peek();
  s.run.value = {
    ...run,
    error: null,
    awaitingFirstChunk: true,
    // Presence decides which arm, the same structural rule fold-mode follows
    // one level up (`loader-reload.ts` moves the phase to `revalidating`, which
    // retains the value, when one is present and `loading` only when none is).
    //
    // With chunks retained this is `reconnecting`, NOT the previous status.
    // Holding the previous status is the tempting shortcut for "keep the fold
    // on screen", and it costs two things: an author has nothing to branch on
    // during the reconnect, and after a failure `status` stays `error` while
    // `error` is cleared here, so `toStreamState` fabricates a placeholder over
    // the user's real diagnostic.
    status: run.length === 0 ? 'connecting' : 'reconnecting',
  };
}

/** Record a stream error, keeping whatever chunks this run has retained. */
export function setCollectError(s: CollectSignals, error: Error): void {
  const run = s.run.peek();
  s.run.value = { ...run, error, status: 'error' };
}

/** Mark the stream cleanly closed (the generator/response ended). */
export function closeCollectSignals(s: CollectSignals): void {
  const run = s.run.peek();
  s.run.value = { ...run, status: 'closed' };
}
