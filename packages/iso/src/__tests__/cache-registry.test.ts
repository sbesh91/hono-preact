import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheRegistry } from '../cache-registry.js';
import { createCache } from '../cache.js';

beforeEach(() => {
  cacheRegistry.clear();
});

describe('cacheRegistry', () => {
  it('calls the registered invalidate function by name', () => {
    const fn = vi.fn();
    cacheRegistry.register('movies', fn);
    cacheRegistry.invalidate('movies');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does nothing when invalidating an unregistered name', () => {
    expect(() => cacheRegistry.invalidate('unknown')).not.toThrow();
  });

  it('re-registering the same name replaces the previous function', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    cacheRegistry.register('movies', fn1);
    cacheRegistry.register('movies', fn2);
    cacheRegistry.invalidate('movies');
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('clear() removes all registered entries', () => {
    const fn = vi.fn();
    cacheRegistry.register('movies', fn);
    cacheRegistry.clear();
    cacheRegistry.invalidate('movies');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('cacheRegistry.acquire', () => {
  it('returns the same cache instance when called twice with the same name', () => {
    const a = cacheRegistry.acquire('shared-name', () => createCache<number>('shared-name'));
    const b = cacheRegistry.acquire('shared-name', () => createCache<number>('shared-name'));
    expect(a).toBe(b);
  });

  it('returns different cache instances for different names', () => {
    const a = cacheRegistry.acquire('name-a', () => createCache<number>('name-a'));
    const b = cacheRegistry.acquire('name-b', () => createCache<number>('name-b'));
    expect(a).not.toBe(b);
  });

  it('invalidating an acquired cache by name clears its store', () => {
    const cache = cacheRegistry.acquire('inv-test', () => createCache<number>('inv-test'));
    cache.set(42);
    expect(cache.get()).toBe(42);
    cacheRegistry.invalidate('inv-test');
    expect(cache.get()).toBeNull();
  });
});
