import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCache } from '../cache.js';
import { cacheRegistry } from '../cache-registry.js';

beforeEach(() => {
  cacheRegistry.clear();
});

describe('createCache', () => {
  it('get() returns null initially', () => {
    const cache = createCache<{ name: string }>();
    expect(cache.get()).toBeNull();
  });

  it('set() + get() round-trip', () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'hello' });
    expect(cache.get()).toEqual({ name: 'hello' });
  });

  it('has() is false before set, true after', () => {
    const cache = createCache<{ name: string }>();
    expect(cache.has()).toBe(false);
    cache.set({ name: 'hello' });
    expect(cache.has()).toBe(true);
  });

  it('wrap() calls loader on cache miss and stores the result', async () => {
    const cache = createCache<{ name: string }>();
    const loader = vi.fn().mockResolvedValue({ name: 'fetched' });
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).toHaveBeenCalledOnce();
    expect(result).toEqual({ name: 'fetched' });
    expect(cache.get()).toEqual({ name: 'fetched' });
  });

  it('wrap() returns cached value on hit without calling loader', async () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'cached' });
    const loader = vi.fn();
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).not.toHaveBeenCalled();
    expect(result).toEqual({ name: 'cached' });
  });

  it('invalidate() resets to null; next wrap() call re-fetches', async () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'old' });
    cache.invalidate();
    expect(cache.get()).toBeNull();
    const loader = vi.fn().mockResolvedValue({ name: 'new' });
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).toHaveBeenCalledOnce();
    expect(result).toEqual({ name: 'new' });
  });

  it('registers with cacheRegistry when a name is provided', () => {
    const cache = createCache<{ val: number }>('test-cache');
    cache.set({ val: 42 });
    expect(cache.get()).toEqual({ val: 42 });
    cacheRegistry.invalidate('test-cache');
    expect(cache.get()).toBeNull();
  });

  it('does not affect cacheRegistry when no name is provided', () => {
    const fn = vi.fn();
    cacheRegistry.register('sentinel', fn);
    createCache<{ val: number }>();
    cacheRegistry.invalidate('sentinel');
    expect(fn).toHaveBeenCalledOnce();
  });
});
