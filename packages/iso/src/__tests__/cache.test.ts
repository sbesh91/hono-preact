import { describe, it, expect } from 'vitest';
import { createCache, runRequestScope } from '../cache.js';
import { env } from '../is-browser.js';

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

  it('invalidate() resets the cache to empty', () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'old' });
    expect(cache.has()).toBe(true);
    cache.invalidate();
    expect(cache.get()).toBeNull();
    expect(cache.has()).toBe(false);
  });
});

describe('LoaderCache: location-aware keying', () => {
  it('returns null from get(locKey) when the cached value was set for a different locKey', () => {
    const cache = createCache<{ id: number }>();
    cache.set({ id: 1 }, '/movies/1?');
    expect(cache.has('/movies/2?')).toBe(false);
    expect(cache.get('/movies/2?')).toBe(null);
  });

  it('returns the value from get(locKey) when locKeys match', () => {
    const cache = createCache<{ id: number }>();
    cache.set({ id: 1 }, '/movies/1?');
    expect(cache.has('/movies/1?')).toBe(true);
    expect(cache.get('/movies/1?')).toEqual({ id: 1 });
  });

  it('treats a no-key set as matching any locKey (back-compat)', () => {
    const cache = createCache<{ id: number }>();
    cache.set({ id: 1 });
    expect(cache.has('/anywhere')).toBe(true);
    expect(cache.get('/anywhere')).toEqual({ id: 1 });
  });
});

describe('createCache request-scoped storage on the server', () => {
  it('does not leak cache writes between concurrent server requests', async () => {
    const cache = createCache<{ user: string }>();
    const previousEnv = env.current;
    env.current = 'server';
    try {
      const observed: Array<{
        before: { user: string } | null;
        after: { user: string } | null;
      }> = [];

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
      expect(observed.map((o) => o.after?.user).sort()).toEqual([
        'alice',
        'bob',
        'carol',
      ]);
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
