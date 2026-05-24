type Key = string; // `${module}::${action}`
type Listener = () => void;

export type StoredActionResult =
  | { kind: 'success'; data: unknown; submittedPayload: unknown }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      submittedPayload: unknown;
    }
  | {
      kind: 'error';
      message: string;
      submittedPayload: unknown | null;
    };

type Entry = StoredActionResult & { module: string; action: string };

const results = new Map<Key, Entry>();
const listeners = new Set<Listener>();

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

export function setLastActionResult(
  module: string,
  action: string,
  result: StoredActionResult
): void {
  const k = key(module, action);
  // Delete-then-set to bump to most-recent position in Map iteration order,
  // so no-stub readers see the latest action result, not the earliest.
  results.delete(k);
  results.set(k, { ...result, module, action });
  for (const l of listeners) l();
}

export function clearLastActionResult(module: string, action: string): void {
  if (results.delete(key(module, action))) {
    for (const l of listeners) l();
  }
}

export function getLastActionResult(
  stub?: { __module: string; __action: string }
): Entry | null {
  if (stub) return results.get(key(stub.__module, stub.__action)) ?? null;
  // No stub: return the most recently written entry.
  let last: Entry | null = null;
  for (const entry of results.values()) last = entry;
  return last;
}

export function subscribeActionResults(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
