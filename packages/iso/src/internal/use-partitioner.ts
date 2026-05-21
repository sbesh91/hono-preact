import type { Middleware } from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';

type UseEntry = Middleware | StreamObserver<unknown, unknown>;

export function partitionUse(use: ReadonlyArray<UseEntry>): {
  middleware: Middleware[];
  observers: StreamObserver<unknown, unknown>[];
} {
  const middleware: Middleware[] = [];
  const observers: StreamObserver<unknown, unknown>[] = [];
  for (const entry of use) {
    if (entry.__kind === 'middleware') middleware.push(entry);
    else observers.push(entry);
  }
  return { middleware, observers };
}
