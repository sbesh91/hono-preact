import type { ComponentChildren } from 'preact';

export interface PersistEntry {
  children: ComponentChildren;
  viewTransitionName: string | undefined;
}

let map = new Map<string, PersistEntry>();
const subs = new Set<() => void>();

export function __persistRegistryWrite(id: string, entry: PersistEntry): void {
  // Replace the map reference so consumers using identity-checks can detect.
  const next = new Map(map);
  next.set(id, entry);
  map = next;
  for (const sub of subs) sub();
}

export function __persistRegistryRead(): ReadonlyMap<string, PersistEntry> {
  return map;
}

export function __persistRegistrySubscribe(sub: () => void): () => void {
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

/** Test-only reset. Do not call from production code. */
export function __persistRegistryResetForTesting(): void {
  map = new Map();
  subs.clear();
}
