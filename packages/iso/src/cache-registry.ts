import type { LoaderCache } from './cache.js';
// Note: type-only import; no runtime dependency on cache.ts.

// Stash storage on globalThis under a Symbol.for key so duplicate copies of
// `@hono-preact/iso` (workspace hoisting quirks, vendor splits, HMR) share a
// single registry. Without this, two copies of the module would each hold
// their own Map and `acquire(name, ...)` could silently return distinct
// instances for the same name.
const STORAGE_KEY = Symbol.for('@hono-preact/iso/cacheRegistry');

type RegistryStorage = {
  registry: Map<string, () => void>;
  acquired: Map<string, unknown>;
};

function getStorage(): RegistryStorage {
  const g = globalThis as unknown as Record<symbol, RegistryStorage>;
  let storage = g[STORAGE_KEY];
  if (!storage) {
    storage = { registry: new Map(), acquired: new Map() };
    g[STORAGE_KEY] = storage;
  }
  return storage;
}

export const cacheRegistry = {
  register(name: string, invalidateFn: () => void): void {
    getStorage().registry.set(name, invalidateFn);
  },
  invalidate(name: string): void {
    getStorage().registry.get(name)?.();
  },
  acquire<T>(name: string, factory: () => LoaderCache<T>): LoaderCache<T> {
    const { acquired } = getStorage();
    const existing = acquired.get(name) as LoaderCache<T> | undefined;
    if (existing) return existing;
    const fresh = factory();
    acquired.set(name, fresh);
    return fresh;
  },
  clear(): void {
    const storage = getStorage();
    storage.registry.clear();
    storage.acquired.clear();
  },
};
