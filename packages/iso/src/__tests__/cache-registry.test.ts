import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheRegistry } from '../cache-registry.js';

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
