type Key = string; // `${module}::${action}`
type Listener = () => void;

const counts = new Map<Key, number>();
const listeners = new Set<Listener>();

function key(module: string, action: string): Key {
  return `${module}::${action}`;
}

export function beginSubmit(module: string, action: string): void {
  const k = key(module, action);
  counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const l of listeners) l();
}

export function endSubmit(module: string, action: string): void {
  const k = key(module, action);
  const n = (counts.get(k) ?? 0) - 1;
  if (n <= 0) counts.delete(k);
  else counts.set(k, n);
  for (const l of listeners) l();
}

export function isPending(stub?: { __module: string; __action: string }): boolean {
  if (stub) return (counts.get(key(stub.__module, stub.__action)) ?? 0) > 0;
  return counts.size > 0;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
