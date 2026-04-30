import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader', () => {
  it('throws when called without a name argument', () => {
    expect(() =>
      // @ts-expect-error: name is required
      defineLoader(async () => ({}))
    ).toThrow(/name must be a non-empty string/);
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
    // defineLoader call sites. This protects useLoaderData(refId === ref.__id)
    // when a consumer ends up importing two copies of the same .server.* module.
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
