/**
 * Single-value loader consumption state. Pattern-match on `status`. The cold
 * `loading` arm declares `data?: never` (rather than omitting `data`) so `data`
 * is uniformly readable on the bare union as `T | undefined` without a narrow,
 * while the cold arm still carries no value (`never` forbids assigning one).
 */
export type LoaderState<T> =
  | { status: 'loading'; data?: never }
  | { status: 'success'; data: T }
  | { status: 'revalidating'; data: T }
  | { status: 'error'; error: Error; data: T };

/**
 * Streaming/live loader consumption state. Pattern-match on `status`. As with
 * `LoaderState`, the cold `connecting` arm declares `data?: never` so `data` is
 * uniformly readable on the bare union without a narrow while carrying no value.
 */
export type StreamState<T> =
  | { status: 'connecting'; data?: never }
  | { status: 'open'; data: T }
  // A resubscribe is in flight over chunks the previous connection already
  // delivered. Distinct from `connecting`, which is the COLD pre-first-chunk
  // arm and carries no value: here the last good fold is still on screen while
  // the reconnect runs, which is what makes retrying safe to offer as a button.
  // Reusing `open` (or holding whatever the status was) left an author nothing
  // to branch on and, after a failure, stranded a cleared error under
  // `status: 'error'` so the placeholder below fired.
  | { status: 'reconnecting'; data: T }
  | { status: 'closed'; data: T }
  // `data` is optional: a COLD stream error (the connect rejects before any
  // chunk) surfaces here with no accumulated value. A post-chunk error still
  // carries the last-good `data`. Read `data` only after narrowing to a
  // data-bearing status (`open`/`closed`), or guard it on the error arm.
  | { status: 'error'; error: Error; data?: T };

/**
 * The streaming lifecycle vocabulary, derived from `StreamState` so the literal
 * union has ONE source of truth (it was previously declared three times). A
 * `.View` consuming a `live` loader reports one of these as `status`.
 */
export type StreamStatus = StreamState<unknown>['status'];

/**
 * The runner's single-value lifecycle as a discriminated union. value-presence
 * is carried STRUCTURALLY by the variant tag, never by a `data === undefined`
 * test: `success` / `revalidating` / `staleError` HAVE a value (which may itself
 * legitimately be `undefined` / `null`, a real resolved value); `loading` and the
 * cold `error` have NONE. Splitting the cold `error` (no value) from `staleError`
 * (an error over a prior value) is what lets a loader that resolves to `undefined`
 * keep its view on a reload failure instead of unwinding the page.
 */
export type LoaderPhase<T> =
  | { tag: 'loading' }
  | { tag: 'revalidating'; value: T }
  | { tag: 'success'; value: T }
  | { tag: 'error'; error: Error }
  | { tag: 'staleError'; error: Error; value: T };

/**
 * A present/absent value. Distinguishes "no value" from a present value that is
 * itself `null` / `undefined`, which a `!== null` test could not. Carries the
 * SSR-preload / browser-cache adoption (`getPreloadedData`) and the runner's
 * synchronously-available settled value.
 */
export type SyncValue<T> = { present: true; value: T } | { present: false };

/**
 * What the runner hands `loader.tsx`: either a renderable union to put on
 * context, or a cold-error signal to route to the `errorFallback` / boundary. A
 * cold error (the load failed before ANY value settled) is the only thing that
 * unwinds the page; every other state renders in-view.
 */
export type LoaderView<T> =
  | { kind: 'render'; state: LoaderState<T> }
  | { kind: 'coldError'; error: Error; fromBakedDeny?: true };

/** Phases that carry a settled value. Structural; no `value !== undefined`. */
type ValuedPhase<T> =
  | { tag: 'revalidating'; value: T }
  | { tag: 'success'; value: T }
  | { tag: 'staleError'; error: Error; value: T };

/**
 * Type predicate: does this phase carry a settled value? Narrows to the
 * value-bearing variants so `phase.value` is `T` without a cast. This is the
 * structural replacement for the old `data !== undefined` value-presence test.
 */
export function hasPhaseValue<T>(p: LoaderPhase<T>): p is ValuedPhase<T> {
  return (
    p.tag === 'success' || p.tag === 'revalidating' || p.tag === 'staleError'
  );
}

/**
 * The statuses that appear ONLY on a streaming `StreamState`, never on a
 * single-value `LoaderState` (the shared `error` status stays on the
 * `LoaderState` side). Derived from the status union via `Exclude`, so the
 * exclusion set has ONE source of truth: adding a `StreamStatus` member forces
 * this map to list it (a missing key is a compile error) and it cannot drift.
 */
type StreamOnlyStatus = Exclude<StreamStatus, LoaderState<unknown>['status']>;
const STREAM_ONLY_STATUSES: Record<StreamOnlyStatus, true> = {
  connecting: true,
  open: true,
  closed: true,
  reconnecting: true,
};

/**
 * Type predicate: is this consumption state the single-value `LoaderState` half
 * of the union? Narrows by excluding the stream-only statuses, so a consumer
 * that only ever sees a non-streaming loader (`useData()`'s no-arg arm, which
 * a streaming loader never reaches) can read the value as a `LoaderState`
 * without a cast. Structural, on the discriminant, like `hasPhaseValue` above.
 */
export function isLoaderState(
  s: LoaderState<unknown> | StreamState<unknown>
): s is LoaderState<unknown> {
  return !(s.status in STREAM_ONLY_STATUSES);
}

/**
 * The current value as a present/absent carrier: the phase's settled value if it
 * carries one, else the synchronously-adopted preload/cache value if present,
 * else absent. STRUCTURAL throughout (the phase branch is `hasPhaseValue`, the
 * sync branch is the `present` flag); NEVER a `value !== undefined` test, so a
 * settled / adopted value of `undefined` / `null` still counts as present. This
 * is the shared three-way the runner's reload and error transitions and
 * `toLoaderView`'s `loading` arm all branch on.
 */
export function resolveCurrentValue<T>(
  phase: LoaderPhase<T>,
  sync: SyncValue<T>
): SyncValue<T> {
  if (hasPhaseValue(phase)) return { present: true, value: phase.value };
  return sync;
}

/**
 * The error object an `error` / `staleError` phase carries, else `null`. A
 * structural read off the variant tag (a `error !== null`-style read), NOT a
 * value-presence test. Lives here with `hasPhaseValue` so all `LoaderPhase`
 * variant-reads share one module.
 */
export function phaseError<T>(p: LoaderPhase<T>): Error | null {
  return p.tag === 'error' || p.tag === 'staleError' ? p.error : null;
}

/**
 * Project the structural phase (plus any synchronously-adopted preload / cache
 * value) into the single-value view. Pure structural dispatch on the variant tag
 * and the `sync.present` flag: NO `data === undefined` / `value !== undefined`
 * test anywhere. A loader that resolves to `undefined` / `null` lands in
 * `success` / `staleError` (it HAS a value) rather than collapsing to `loading`;
 * only a cold `error` (no value) becomes the `coldError` signal `loader.tsx`
 * routes to the boundary.
 */
export function toLoaderView<T>(
  phase: LoaderPhase<T>,
  sync: SyncValue<T>
): LoaderView<T> {
  switch (phase.tag) {
    case 'success':
      return {
        kind: 'render',
        state: { status: 'success', data: phase.value },
      };
    case 'revalidating':
      return {
        kind: 'render',
        state: { status: 'revalidating', data: phase.value },
      };
    case 'staleError':
      return {
        kind: 'render',
        state: { status: 'error', error: phase.error, data: phase.value },
      };
    case 'error':
      return { kind: 'coldError', error: phase.error };
    case 'loading': {
      // A still-`loading` phase whose value is already available synchronously
      // (an SSR preload or browser-cache hit) renders as `success` from that
      // value; with no such value it is a genuine cold load.
      const current = resolveCurrentValue(phase, sync);
      return current.present
        ? { kind: 'render', state: { status: 'success', data: current.value } }
        : { kind: 'render', state: { status: 'loading' } };
    }
  }
}

/**
 * Project the streaming lifecycle into a `StreamState`, keyed on `status` ALONE
 * (never on `data === undefined`). An open / closed stream whose accumulated
 * value is legitimately `undefined` therefore surfaces as `open` / `closed` with
 * `data: undefined`, not stuck on `connecting`. `value` is the accumulated value
 * as a present/absent carrier; a cold connect error (no chunk yet) reaches the
 * `error` arm without data.
 */
export function toStreamState<T>(
  status: StreamStatus,
  value: SyncValue<T>,
  error: Error | null
): StreamState<T> {
  switch (status) {
    case 'connecting':
      return { status: 'connecting' };
    case 'open':
      // `open`/`closed` are only ever set once the accumulator exists, so the
      // absent fallback is unreachable defense, not a value-presence decision.
      return value.present
        ? { status: 'open', data: value.value }
        : { status: 'connecting' };
    case 'closed':
      return value.present
        ? { status: 'closed', data: value.value }
        : { status: 'connecting' };
    case 'reconnecting':
      // Only reachable WITH a retained value: the runner reports `connecting`
      // instead when nothing has been delivered, so the absent fallback is
      // unreachable defense rather than a value-presence decision.
      return value.present
        ? { status: 'reconnecting', data: value.value }
        : { status: 'connecting' };
    case 'error': {
      // `error` is the streaming error OBJECT, not a value-presence test. The
      // runner only sets `status === 'error'` alongside a real error, so the
      // `??` fallback is unreachable defense that keeps the arm's `error: Error`.
      const err =
        error ?? new Error('Streaming loader errored before settling.');
      return value.present
        ? { status: 'error', error: err, data: value.value }
        : { status: 'error', error: err };
    }
  }
}

/**
 * Handlers for every arm of a `status`-discriminated state, each receiving the
 * fully narrowed member. `Extract` is what makes the `success` handler read
 * `data` with no guard while the `loading` handler cannot read it at all.
 */
type ExhaustiveHandlers<S extends { status: string }, R> = {
  [K in S['status']]: (state: Extract<S, { status: K }>) => R;
};

/**
 * Status-first narrowing over a loader or stream state. The caller cannot reach
 * a `data` branch without the type system having narrowed `status` first, which
 * is what makes a legitimately falsy value (`0`, `''`, `[]`) impossible to
 * misread as "still loading".
 *
 * One implementation serves both `LoaderState` and `StreamState`: both
 * discriminate on the same `status` key, so the streaming arms come along free.
 *
 * Exhaustive by default (a missing arm is a compile error). Supplying `_` as a
 * catch-all allows a partial map instead; that is the escape hatch, not the
 * habit.
 */
export function match<S extends { status: string }, R>(
  state: S,
  handlers: ExhaustiveHandlers<S, R>
): R;
export function match<S extends { status: string }, R>(
  state: S,
  handlers: Partial<ExhaustiveHandlers<S, R>> & { _: (state: S) => R }
): R;
export function match<S extends { status: string }, R>(
  state: S,
  handlers: Partial<ExhaustiveHandlers<S, R>> & { _?: (state: S) => R }
): R {
  const handler = handlers[state.status as S['status']];
  if (handler) return (handler as (s: S) => R)(state);
  // Unreachable through either public overload: the exhaustive form requires
  // every arm and the partial form requires `_`. Kept as a real throw rather
  // than a cast so a JS caller gets a legible failure instead of `undefined`.
  const fallback = handlers._;
  if (fallback) return fallback(state);
  throw new Error(
    `hono-preact: match() has no handler for status ${JSON.stringify(state.status)} and no \`_\` fallback.`
  );
}
