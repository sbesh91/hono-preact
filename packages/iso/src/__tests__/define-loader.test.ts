import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader', () => {
  it('returns an unkeyed LoaderRef when called with only a function (no name, no opts)', () => {
    // The (fn) form is now valid. The plugin will rewrite it to (fn, { __moduleKey })
    // at build time. Without opts the symbol is local (not registered), so
    // Symbol.keyFor returns undefined.
    const ref = defineLoader(async () => ({}));
    expect(typeof ref.__id).toBe('symbol');
    expect(Symbol.keyFor(ref.__id)).toBeUndefined();
  });

});

describe('defineLoader type-level guards', () => {
  it('rejects the legacy (name, fn) form at the type level', () => {
    // @ts-expect-error: defineLoader no longer accepts a string as the first
    // argument; the (name, fn) overload was removed in the path-keyed identity
    // refactor.
    defineLoader('movies', async () => ({}));
  });
});

describe('defineLoader (path-keyed __moduleKey form)', () => {
  it('accepts (fn, { __moduleKey }) and derives __id from the key', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'apps/app/src/pages/movies',
    });
    expect(Symbol.keyFor(ref.__id)).toBe(
      '@hono-preact/loader:apps/app/src/pages/movies'
    );
  });

  it('produces the same __id symbol for two calls with the same __moduleKey', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    expect(a.__id).toBe(b.__id);
  });

  it('produces distinct __id for distinct __moduleKey values', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), {
      __moduleKey: 'pages/admin/movies',
    });
    expect(a.__id).not.toBe(b.__id);
  });
});
