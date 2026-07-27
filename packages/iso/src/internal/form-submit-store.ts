import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

type Key = string; // `${module}::${action}`

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

// The signal holds the whole keyed counts map (a fresh Map instance on every
// write, so the identity change drives the signal). Module-private and
// WRITABLE; `beginSubmit` / `endSubmit` are the only writers.
const store = signal<ReadonlyMap<Key, number>>(new Map());

/**
 * The reactive read channel: `useFormStatus`'s `useComputed` reads `.value`
 * (subscribing); `isPending` below reads `.peek()` (non-reactive). Published
 * as a `ReadonlySignal` so a consumer can subscribe but cannot write around
 * the begin/end pair.
 */
export const pendingSignal: ReadonlySignal<ReadonlyMap<Key, number>> = store;

/**
 * Pure filter over a counts snapshot: pending for a specific stub, or pending
 * globally (any in-flight submit) when no stub is given.
 */
export function pickIsPending(
  counts: ReadonlyMap<Key, number>,
  stub?: { __module: string; __action: string }
): boolean {
  if (stub) return (counts.get(key(stub.__module, stub.__action)) ?? 0) > 0;
  return counts.size > 0;
}

export function beginSubmit(module: string, action: string): void {
  const k = key(module, action);
  const next = new Map(store.peek());
  next.set(k, (next.get(k) ?? 0) + 1);
  store.value = next;
}

export function endSubmit(module: string, action: string): void {
  const k = key(module, action);
  const next = new Map(store.peek());
  const n = (next.get(k) ?? 0) - 1;
  if (n <= 0) next.delete(k);
  else next.set(k, n);
  store.value = next;
}

/** Non-reactive peek; see `pickIsPending`. */
export function isPending(stub?: {
  __module: string;
  __action: string;
}): boolean {
  return pickIsPending(store.peek(), stub);
}
