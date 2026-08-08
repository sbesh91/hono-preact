import type { Signal } from '@preact/signals';
import { shallowEqual } from './shallow-equal.js';

/**
 * Write a signal only when the value actually changed.
 *
 * A signal write ALWAYS notifies, and `@preact/signals` dedupes on `===`, which
 * is the one thing a value built during render does not hold still. So a
 * publish site whose source is a render expression has to compare contents, and
 * every site that forgot to wakes every consumer bound to that signal for a
 * value they cannot tell apart from the last one. That is a silent failure: it
 * costs renders, never correctness, so nothing fails and no test notices unless
 * it was written to count renders.
 *
 * Reads through `peek()`, never `.value`: this runs during render at most call
 * sites, and a tracked read would subscribe the CALLING component to the signal
 * it is writing.
 *
 * **The comparator is a parameter because a single depth does not fit.** One
 * level is right for a list of entities keyed by identity, and wrong wherever
 * the meaningful value sits deeper: a presence member is `{ id, state }`, so
 * comparing the member one level deep tests `state` by identity, which is a
 * fresh object off the wire every time and never dedupes. Sites like that pass
 * their own. Defaulting to `shallowEqual` keeps the safe behaviour automatic and
 * makes a deviation explicit at the call site rather than absent from it.
 *
 * NOT for event-driven writes. A store recording a submit, a chunk appended to
 * a stream, a queue entry added on dispatch: each of those is a genuine
 * transition by construction, so the comparison is pure overhead, and in
 * `appendCollectChunk`'s case actively wrong, since the chunks array's IDENTITY
 * is the generation mechanism a fold's cursor resets on.
 */
export function publish<T>(
  signal: Signal<T>,
  next: T,
  eq: (a: T, b: T) => boolean = shallowEqual
): void {
  if (eq(signal.peek(), next)) return;
  signal.value = next;
}
