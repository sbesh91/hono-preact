import type { Middleware } from '../define-middleware.js';
import {
  assertUseEntry,
  isMiddleware,
  type AnyObserver,
} from './use-entry.js';

/**
 * Split a `use` array into middleware and stream observers.
 *
 * Takes `ReadonlyArray<unknown>` because that is how the data genuinely
 * arrives: page-level and unit-level `use` are structural reads off
 * user-defined modules. Callers used to cast into a typed array to get in
 * here, and the cast was exactly what let a malformed entry through. The
 * runtime check is now the single source of truth for this boundary, and
 * the predicates do the narrowing.
 *
 * `source` labels the layer in the error message (e.g. "the app-level
 * `use`"); pass it wherever the caller knows which array it holds.
 */
export function partitionUse(
  use: ReadonlyArray<unknown>,
  source?: string
): {
  middleware: Middleware[];
  observers: AnyObserver[];
} {
  const middleware: Middleware[] = [];
  const observers: AnyObserver[] = [];
  for (let index = 0; index < use.length; index++) {
    const entry = use[index];
    assertUseEntry(entry, index, source);
    if (isMiddleware(entry)) middleware.push(entry);
    else observers.push(entry);
  }
  return { middleware, observers };
}
