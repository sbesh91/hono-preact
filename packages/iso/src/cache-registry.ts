const registry = new Map<string, () => void>();

export const cacheRegistry = {
  register(name: string, invalidateFn: () => void): void {
    registry.set(name, invalidateFn);
  },
  invalidate(name: string): void {
    registry.get(name)?.();
  },
  clear(): void {
    registry.clear();
  },
};
