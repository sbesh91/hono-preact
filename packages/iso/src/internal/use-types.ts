import type {
  ServerMiddleware,
  ClientMiddleware,
  Scope,
} from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

export type Use<
  S extends Scope,
  Streaming extends boolean,
  T = unknown,
  R = void,
> = ReadonlyArray<
  | ServerMiddleware<S>
  | (S extends 'page' ? ClientMiddleware : never)
  | (Streaming extends true ? StreamObserver<T, R> : never)
>;

// A route node's `use` must handle EVERY scope, for the same reason
// `AppUseElement` must: `composeServerChain` folds the page tier
// (`resolvePageUse(path)`) into the loader chain and the action chain as well
// as the page render, and those handlers dispatch it with a `ServerLoaderCtx`
// / `ServerActionCtx`. A route guard is a route guard in all three.
//
// This previously read `ServerMiddleware<'page'>`, on the stated grounds that
// naming the whole `Scope` union would distribute and let an
// explicitly-tagged loader or action middleware in. Two things were wrong with
// that. The distribution concern is real but is handled by
// `ServerMiddleware<S>` being CONTRAVARIANT in `S` (see `ServerCtx`'s indexed
// access in define-middleware.ts): an all-scope slot rejects every
// single-scope form, including `<'page'>`. And the promise `<'page'>` made was
// the unsound one: a `<'page'>` entry here is handed a loader ctx at runtime,
// so `throw render(...)` from a route guard surfaces as a 500 on that route's
// loader RPC rather than as a page render.
//
// Non-distributive spelling is still deliberate, so the union stays exactly
// these three arms.
//
// Unlike `AppUseElement`, this union keeps `ClientMiddleware`: the route tree
// is in the client module graph and `startChain` dispatches the
// `runs === 'client'` entries of a route node's `use` on navigation. The two
// unions coincided until #359 narrowed the app tier, which is why
// `RouteUseElement` is exported by name: `RouteUseElement[]` is the correct
// annotation for a route node's `use`, where `AppUseElement[]` would reject
// the client middleware this tier supports.
export type RouteUseElement =
  | ServerMiddleware<Scope>
  | ClientMiddleware
  | StreamObserver<unknown, never>;

export type PageUse = ReadonlyArray<RouteUseElement>;

export type LoaderUse<T, Streaming extends boolean> = Use<
  'loader',
  Streaming,
  T,
  void
>;
export type ActionUse<TChunk, TResult, Streaming extends boolean> = Use<
  'action',
  Streaming,
  TChunk,
  TResult
>;

/**
 * One entry of an action's `use`, spelled so a `const` type parameter on
 * `defineAction` can capture the literal tuple (and therefore each element's
 * own `TDeny`) before it widens to the erasing array element type.
 *
 * `unknown` suffices in the TDeny slot here because TDeny sits only
 * covariantly in `ServerMiddleware` (the `fn` return's `DenyOutcome`), so a
 * narrowly-typed guard is assignable to the `unknown`-typed element and the
 * `const U` capture still sees each element's own TDeny. Contrast the two
 * `any`s that remain in this file: `ActionUseElements` needs them for the
 * observer's TChunk/TResult (contravariant), and `DenyOfElement` needs one in
 * the pattern's scope position (contravariant ctx); `unknown` breaks both,
 * with type-test failures to prove it.
 */
export type ActionUseElement<TChunk = unknown, TResult = unknown> =
  | ServerMiddleware<'action', unknown>
  | StreamObserver<TChunk, TResult>;

/**
 * The CONSTRAINT for `defineAction`'s `const U` parameter. Deliberately free of
 * `TChunk` / `TResult`: a constraint that mentioned them would be checked while
 * they are still unfixed, and TypeScript would settle them at their defaults
 * before `fn` got a chance to infer, silently collapsing a streaming action's
 * chunk type to `never`. `use`'s declared type intersects this tuple capture
 * with the ordinary `ActionUse<TChunk, TResult, boolean>`, so the observer
 * arms are still checked against the action's own chunk and result types.
 *
 * `never` for the observer's chunk and result is the exact supertype, not a
 * widening: both sit in parameter position on `onChunk` / `onEnd`, so they are
 * contravariant, and `StreamObserver<never, never>` therefore admits every
 * observer. (`unknown` would be the supertype only in a covariant slot, and
 * here it rejects real observers.)
 */
export type ActionUseElements = ReadonlyArray<ActionUseElement<never, never>>;

// Per-element extraction in its OWN single-parameter alias, which is the whole
// trick. Instantiating `DenyOfElement<U[K]>` passes a fresh type argument, and
// `X extends ...` inside this body IS a naked type-parameter reference, so it
// DISTRIBUTES over `U[K]`'s members. Inlining this conditional in the mapped
// type below does not distribute (`U[K]` is an indexed access, not a naked
// reference): it would test the whole element union against the middleware
// pattern in one shot, fail on the observer arm, and collapse the entire
// result to `never`.
//
// The scope in the pattern is `never` for the same variance reason. `fn` takes
// `ctx: ServerCtx<S>`, so `S` is contravariant, and `ServerCtx<never>` is
// `never` (an indexed access on a `never` key). A parameter of type `never`
// accepts every concrete ctx, so the pattern matches a middleware of ANY
// scope and `D` unifies from the TDeny position as intended. Naming a scope
// (`'action'`, or the `Scope` union) instead makes the ctx comparison gate the
// match and collapses the result to `never`.
type DenyOfElement<X> =
  X extends ServerMiddleware<never, infer D> ? DemoteAny<D> : never;

// A guard is free to type its own deny data `any`. Its author is not the party
// who pays: `D` lands on `deny.data` in the ACTION CALLER's `MutateResult`,
// where an `any` would silently switch off checking for someone who never
// wrote it. Demote it to `unknown` so the caller still has to narrow.
// `0 extends 1 & D` is only ever true for `any`.
type DemoteAny<D> = 0 extends 1 & D ? unknown : D;

/**
 * The union of the deny-data types across a `use` array. Stream observers (and
 * anything else that is not a server middleware) fall out to `never` and
 * vanish from the union. A pre-typed, non-literal array degrades to `unknown`
 * rather than erroring: for a genuine array type `keyof U` is an index
 * signature, so every `U[K]` is the whole element union, whose middleware arm
 * carries the defaulted `unknown` TDeny.
 */
export type DenyOf<U extends ReadonlyArray<unknown>> = {
  [K in keyof U]: DenyOfElement<U[K]>;
}[number];
