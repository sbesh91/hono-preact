import { createStoreSignal } from './store-signal.js';
import type { ReadonlySignal } from '@preact/signals';

type Key = string; // `${module}::${action}`

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

// The signal holds the whole keyed counts map (a fresh Map instance on every
// write, so the identity change drives the signal); `store-signal.js` is the
// sanctioned `@preact/signals` importer, so this module never imports it
// directly (the module-graph guard).
const store = createStoreSignal<ReadonlyMap<Key, number>>(new Map());

/**
 * The reactive read channel: `useFormStatus`'s `useComputed` reads `.value`
 * (subscribing); `isPending` below reads `.peek()` (non-reactive).
 */
export const pendingSignal: ReadonlySignal<ReadonlyMap<Key, number>> =
  store.signal;

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
  const next = new Map(store.signal.peek());
  next.set(k, (next.get(k) ?? 0) + 1);
  store.set(next);
}

export function endSubmit(module: string, action: string): void {
  const k = key(module, action);
  const next = new Map(store.signal.peek());
  const n = (next.get(k) ?? 0) - 1;
  if (n <= 0) next.delete(k);
  else next.set(k, n);
  store.set(next);
}

/** Non-reactive peek; see `pickIsPending`. */
export function isPending(stub?: {
  __module: string;
  __action: string;
}): boolean {
  return pickIsPending(store.signal.peek(), stub);
}
