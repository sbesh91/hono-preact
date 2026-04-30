import type { LoaderCache } from './cache.js';
// Note: type-only import; no runtime dependency on cache.ts.

const registry = new Map<string, () => void>();
const acquired = new Map<string, unknown>();

export const cacheRegistry = {
  register(name: string, invalidateFn: () => void): void {
    registry.set(name, invalidateFn);
  },
  invalidate(name: string): void {
    registry.get(name)?.();
  },
  acquire<T>(name: string, factory: () => LoaderCache<T>): LoaderCache<T> {
    const existing = acquired.get(name) as LoaderCache<T> | undefined;
    if (existing) return existing;
    const fresh = factory();
    acquired.set(name, fresh);
    return fresh;
  },
  clear(): void {
    registry.clear();
    acquired.clear();
  },
};
