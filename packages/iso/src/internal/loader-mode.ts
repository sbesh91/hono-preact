/**
 * Streaming consumption options, exactly as authored on the public surface:
 * `.View(render, { initial, reduce })` and `.Boundary accumulate={...}`. Fold
 * every chunk through `reduce` into an accumulated value.
 *
 * This lives beside `LoaderMode` rather than in the runner hook because the two
 * renderer-free modules that name it (`loader-readers.ts`, `loader-reload.ts`)
 * were importing it from a `.tsx` hook module, which inverted the layering: the
 * point of extracting those modules was that they can be built and tested
 * without a renderer.
 */
export type AccumulateOptions = {
  initial: unknown;
  reduce: (acc: unknown, chunk: unknown) => unknown;
};

/**
 * How ONE loader host consumes its loader.
 *
 * This replaces an `accumulate?: AccumulateOptions` + `collect?: boolean` pair
 * threaded through five modules, whose "never both set" rule was asserted in
 * prose in six places, enforced at exactly one construction site, and enforced
 * by the types nowhere. As a union the rule is unrepresentable, and the fold
 * payload travels WITH the mode that uses it (so reading `reduce` needs no
 * non-null assertion).
 *
 *  - `single`: one value. Consumers read a `LoaderState` off `useData()`; the
 *    server render awaits the value and bakes it into `data-loader`.
 *  - `fold`: streaming consumption that reduces every chunk into an accumulator
 *    the host itself renders. Selected by `.View(render, { initial, reduce })`,
 *    and by `.Boundary accumulate={...}` on a non-streaming loader (a supported
 *    host: see `resolveLoaderMode` below).
 *  - `collect`: streaming consumption that APPENDS every chunk to a retained log
 *    signal instead of folding, so N independent `useData(initial, reduce)`
 *    consumers under one host can fold the SAME log differently off ONE
 *    subscription. Selected by a streaming loader's `.Boundary` (no
 *    `accumulate`).
 */
export type LoaderMode =
  | { kind: 'single' }
  | ({ kind: 'fold' } & AccumulateOptions)
  | { kind: 'collect' };

// The two payload-free modes are shared module-level instances rather than a
// fresh literal per resolve: a host in either mode then keeps ONE mode identity
// for its whole lifetime, so the runner's mode-keyed callbacks never churn. Read
// only; nothing in this package writes a `LoaderMode`.
const SINGLE_MODE: LoaderMode = { kind: 'single' };
const COLLECT_MODE: LoaderMode = { kind: 'collect' };

/**
 * Pick a host's mode from the consumption form it was given.
 *
 * THE ORDER IS LOAD-BEARING: `accumulate` is tested FIRST, before `isStreaming`.
 * Non-streaming + `accumulate` is a supported host (`LoaderRef<T, false>`'s
 * `.Boundary` declares the `accumulate` prop), and it must resolve to `fold`.
 * Testing `isStreaming` first would send it to `single`, which flips BOTH the
 * SSR projection (a baked `success` `LoaderState` instead of the unbaked
 * `connecting` `StreamState`) and the client's first render, i.e. a hydration
 * mismatch rather than a visible failure.
 *
 * `isStreaming` is the loader's own shape (an async-generator fn), not the
 * `live` SSR-opt-out flag: a finite streaming loader collects too.
 */
export function resolveLoaderMode(
  accumulate: AccumulateOptions | undefined,
  isStreaming: boolean
): LoaderMode {
  if (accumulate) return { kind: 'fold', ...accumulate };
  return isStreaming ? COLLECT_MODE : SINGLE_MODE;
}

/**
 * Does this host consume a STREAM (either by folding chunks or by collecting
 * them)? The two streaming modes share the subscription-shaped reader, the
 * resubscribe-on-reload branch, and the "bake nothing, the client reconnects"
 * SSR projection; only chunk handling differs. This is the `accumulate ||
 * collect` test those three sites used to spell by hand.
 */
export function isStreamingMode(mode: LoaderMode): boolean {
  return mode.kind !== 'single';
}
