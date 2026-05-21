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

export type AppUse = Use<Scope, true>;
export type PageUse = Use<Scope, true>;
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
