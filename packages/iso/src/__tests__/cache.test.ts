import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCache, runRequestScope } from '../cache.js';
import { cacheRegistry } from '../cache-registry.js';
import { env } from '../is-browser.js';

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

describe('createCache request-scoped storage on the server', () => {
  it('does not leak cache writes between concurrent server requests', async () => {
    const cache = createCache<{ user: string }>();
    const previousEnv = env.current;
    env.current = 'server';
    try {
      const observed: Array<{ before: { user: string } | null; after: { user: string } | null }> = [];

      const handleRequest = async (user: string) => {
        return runRequestScope(async () => {
          const before = cache.get();
          await Promise.resolve();
          cache.set({ user });
          await Promise.resolve();
          const after = cache.get();
          observed.push({ before, after });
        });
      };

      await Promise.all([
        handleRequest('alice'),
        handleRequest('bob'),
        handleRequest('carol'),
      ]);

      for (const o of observed) {
        expect(o.before).toBeNull();
      }
      expect(observed.map((o) => o.after?.user).sort()).toEqual(['alice', 'bob', 'carol']);
    } finally {
      env.current = previousEnv;
    }
  });

  it('cache.wrap() inside runRequestScope only sees its own request data', async () => {
    const cache = createCache<{ id: number }>();
    const previousEnv = env.current;
    env.current = 'server';
    try {
      const handle = (id: number) =>
        runRequestScope(async () => {
          const wrapped = cache.wrap(async () => {
            await Promise.resolve();
            return { id };
          });
          const a = await wrapped({ location: {} as never });
          const b = await wrapped({ location: {} as never });
          return { a, b };
        });

      const [r1, r2, r3] = await Promise.all([handle(1), handle(2), handle(3)]);
      expect(r1.a).toEqual({ id: 1 });
      expect(r1.b).toEqual({ id: 1 });
      expect(r2.a).toEqual({ id: 2 });
      expect(r2.b).toEqual({ id: 2 });
      expect(r3.a).toEqual({ id: 3 });
      expect(r3.b).toEqual({ id: 3 });
    } finally {
      env.current = previousEnv;
    }
  });

  it('falls back to module-scoped storage when no request scope is active (browser path)', () => {
    const cache = createCache<{ val: number }>();
    cache.set({ val: 7 });
    expect(cache.get()).toEqual({ val: 7 });
  });
});
