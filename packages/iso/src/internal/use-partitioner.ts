import type { Middleware } from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

// `StreamObserver<TChunk, TResult>` is invariant in `TResult` (it appears
// in callback arg positions, e.g. `onEnd({ result: TResult })`), so any
// concrete instantiation we declare here would reject sibling observers
// with a different TResult. The partitioner only cares about __kind, so
// we accept the broadest structural shape and pay nothing at runtime.
type AnyObserver = StreamObserver<unknown, never>;
type UseEntry = Middleware | AnyObserver;

export function partitionUse(use: ReadonlyArray<UseEntry>): {
  middleware: Middleware[];
  observers: AnyObserver[];
} {
  const middleware: Middleware[] = [];
  const observers: AnyObserver[] = [];
  for (const entry of use) {
    if (entry.__kind === 'middleware') middleware.push(entry);
    else observers.push(entry);
  }
  return { middleware, observers };
}
