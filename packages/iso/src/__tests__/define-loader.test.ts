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

  it('throws when name is an empty string', () => {
    expect(() => defineLoader('', async () => ({}))).toThrow(
      /name must be a non-empty string/
    );
  });

  it('keys __id with Symbol.for so two calls with the same name share identity', () => {
    const a = defineLoader('movies', async () => ({}));
    const b = defineLoader('movies', async () => ({}));
    // Same name produces the same registered symbol, even across distinct
    // defineLoader call sites. This ensures stable loader identity for prefetch
    // and cache keying when a consumer imports two copies of the same .server.* module.
    expect(a.__id).toBe(b.__id);
    expect(typeof Symbol.keyFor(a.__id)).toBe('string');
    expect(Symbol.keyFor(a.__id)).toBe('@hono-preact/loader:movies');
  });

  it('produces distinct __id for distinct names', () => {
    const a = defineLoader('movies', async () => ({}));
    const b = defineLoader('reviews', async () => ({}));
    expect(a.__id).not.toBe(b.__id);
  });

  it('aligns with the SSR stub symbol shape (Symbol.for("@hono-preact/loader:<name>"))', () => {
    const ref = defineLoader('movies', async () => ({}));
    const stubSymbol = Symbol.for('@hono-preact/loader:movies');
    // The stub fabricated by the server-only Vite plugin uses this exact key,
    // so identity is stable across the user-authored module and the client stub.
    expect(ref.__id).toBe(stubSymbol);
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
