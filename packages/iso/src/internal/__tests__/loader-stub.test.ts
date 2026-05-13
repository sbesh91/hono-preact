// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { __$createLoaderStub_hpiso } from '../loader-stub.js';

describe('__$createLoaderStub_hpiso', () => {
  it('returns a LoaderRef-shaped object', () => {
    const stub = __$createLoaderStub_hpiso({
      __moduleKey: 'pages/movie',
      __loaderName: 'summary',
    });
    expect(stub.__moduleKey).toBe('pages/movie');
    expect(stub.__loaderName).toBe('summary');
    expect(typeof stub.__id).toBe('symbol');
    expect(Symbol.keyFor(stub.__id)).toBe('@hono-preact/loader:pages/movie::summary');
    expect(typeof stub.fn).toBe('function');
    expect(typeof stub.useData).toBe('function');
    expect(typeof stub.useError).toBe('function');
    expect(typeof stub.invalidate).toBe('function');
    expect(typeof stub.View).toBe('function');
    expect(stub.Boundary).toBeDefined();
    expect(stub.params).toEqual([]);
  });

  it('two stubs with the same key share __id (and thus cache)', () => {
    const a = __$createLoaderStub_hpiso({ __moduleKey: 'pages/x', __loaderName: 'foo' });
    const b = __$createLoaderStub_hpiso({ __moduleKey: 'pages/x', __loaderName: 'foo' });
    expect(a.__id).toBe(b.__id);
  });
});
