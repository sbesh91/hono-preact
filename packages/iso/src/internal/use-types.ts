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
