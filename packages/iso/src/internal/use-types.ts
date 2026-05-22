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

// Page-level `use` arrays accept only page-scope server middleware. Writing
// the type out non-distributively (rather than `Use<Scope, true>`) is
// deliberate: when `S` is the full `Scope` union, `Use<S, ...>` distributes
// over `S` and would expand to `ServerMiddleware<'page'> | ServerMiddleware<
// 'loader'> | ServerMiddleware<'action'> | ...`, accepting an
// explicitly-tagged loader or action middleware where a page middleware is
// required. At runtime the page host casts to `ServerMiddleware<'page'>`,
// so a mis-scoped middleware reading `ctx.module` / `ctx.loader` would see
// undefined. Keep this list explicit.
export type PageUse = ReadonlyArray<
  ServerMiddleware<'page'> | ClientMiddleware | StreamObserver<unknown, never>
>;

// `AppUse` is structurally identical to `PageUse`: `render.tsx` dispatches
// app-level middleware with `scope: 'page'`, so the same restriction
// applies. Aliased so changes to the page shape ripple here automatically.
export type AppUse = PageUse;

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
