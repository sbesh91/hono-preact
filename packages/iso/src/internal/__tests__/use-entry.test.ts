import { describe, it, expect } from 'vitest';
import { isMiddleware, isObserver, assertUseEntry } from '../use-entry.js';
import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '../../define-middleware.js';
import { defineStreamObserver } from '../../define-stream-observer.js';

// `_c: unknown` rather than a concrete ctx: parameter contravariance makes
// this assignable to BOTH `ServerMiddleware['fn']` and `ClientMiddleware['fn']`,
// so one helper feeds every factory below. (`never` does not work: a parameter
// of type `never` accepts no argument at all.)
const noop = async (_c: unknown, next: () => Promise<unknown>) => {
  await next();
};

describe('isMiddleware', () => {
  it('accepts what the define* factories produce', () => {
    expect(isMiddleware(defineServerMiddleware(noop))).toBe(true);
    expect(isMiddleware(defineClientMiddleware(noop))).toBe(true);
  });

  it('accepts the build-time guard-strip replacement literals', () => {
    // packages/vite/src/guard-strip.ts inlines these into the wrong-env
    // bundle in place of a stripped defineServerMiddleware/
    // defineClientMiddleware call. They must stay classifiable.
    expect(
      isMiddleware({
        __kind: 'middleware',
        runs: 'client',
        fn: (_ctx: unknown, next: () => unknown) => next(),
      })
    ).toBe(true);
    expect(
      isMiddleware({
        __kind: 'middleware',
        runs: 'server',
        fn: (_ctx: unknown, next: () => unknown) => next(),
      })
    ).toBe(true);
  });

  it('rejects a bad `runs`, so a typo cannot survive into the runs filter', () => {
    expect(
      isMiddleware({ __kind: 'middleware', runs: 'sever', fn: noop })
    ).toBe(false);
    expect(isMiddleware({ __kind: 'middleware', fn: noop })).toBe(false);
  });

  it('rejects a missing or non-function `fn`', () => {
    expect(isMiddleware({ __kind: 'middleware', runs: 'server' })).toBe(false);
    expect(
      isMiddleware({ __kind: 'middleware', runs: 'server', fn: 'guard' })
    ).toBe(false);
  });

  it('rejects observers, non-objects, and a missing brand', () => {
    expect(isMiddleware(defineStreamObserver({}))).toBe(false);
    expect(isMiddleware(null)).toBe(false);
    expect(isMiddleware(undefined)).toBe(false);
    expect(isMiddleware(noop)).toBe(false);
    expect(isMiddleware('guard')).toBe(false);
    expect(isMiddleware({ fn: noop })).toBe(false);
  });
});

describe('isObserver', () => {
  it('accepts what defineStreamObserver produces, with and without hooks', () => {
    expect(isObserver(defineStreamObserver({}))).toBe(true);
    expect(isObserver(defineStreamObserver({ onStart: () => {} }))).toBe(true);
    expect(
      isObserver(
        defineStreamObserver({
          onStart: () => {},
          onChunk: () => {},
          onEnd: () => {},
          onError: () => {},
          onAbort: () => {},
        })
      )
    ).toBe(true);
  });

  it('accepts the bare guard-strip replacement literal', () => {
    // guard-strip.ts replaces a stripped defineStreamObserver() call with
    // exactly `{ __kind: 'observer' }` in the client bundle.
    expect(isObserver({ __kind: 'observer' })).toBe(true);
  });

  it('rejects a present hook that is not a function', () => {
    expect(isObserver({ __kind: 'observer', onChunk: 3 })).toBe(false);
    expect(isObserver({ __kind: 'observer', onStart: null })).toBe(false);
  });

  it('rejects middleware, non-objects, and a missing brand', () => {
    expect(isObserver(defineServerMiddleware(noop))).toBe(false);
    expect(isObserver(null)).toBe(false);
    expect(isObserver(undefined)).toBe(false);
    expect(isObserver(noop)).toBe(false);
    expect(isObserver({ onChunk: () => {} })).toBe(false);
  });
});

describe('assertUseEntry', () => {
  it('passes valid middleware and observers through', () => {
    expect(() => assertUseEntry(defineServerMiddleware(noop), 0)).not.toThrow();
    expect(() => assertUseEntry(defineStreamObserver({}), 0)).not.toThrow();
  });

  it('names the index and the source label', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middlware' }, 2, 'the app-level `use`')
    ).toThrow(/Invalid `use` entry at index 2 of the app-level `use`:/);
  });

  it('omits the source clause when no label is given', () => {
    expect(() => assertUseEntry({ __kind: 'middlware' }, 0)).toThrow(
      /^Invalid `use` entry at index 0: /
    );
  });

  it('always explains why a silent drop matters', () => {
    expect(() => assertUseEntry(null, 0)).toThrow(
      /would be silently dropped from the middleware chain -- if this is an auth gate, it would not run\.$/
    );
  });

  it('diagnoses a middleware with a bad `runs`', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middleware', runs: 'sever', fn: noop }, 0)
    ).toThrow(
      /a middleware whose `runs` is "sever" \(expected 'server' or 'client'\)/
    );
  });

  it('diagnoses a middleware with a BigInt `runs` without throwing', () => {
    // JSON.stringify throws on a BigInt; the diagnosis must not replace itself
    // with that TypeError.
    expect(() =>
      assertUseEntry({ __kind: 'middleware', runs: 1n, fn: noop }, 0)
    ).toThrow(
      /a middleware whose `runs` is 1n \(expected 'server' or 'client'\)/
    );
  });

  it('diagnoses a middleware with a bad `fn`', () => {
    expect(() =>
      assertUseEntry({ __kind: 'middleware', runs: 'server' }, 0)
    ).toThrow(/a middleware whose `fn` is not a function \(undefined\)/);
  });

  it('diagnoses an observer with a bad hook', () => {
    expect(() => assertUseEntry({ __kind: 'observer', onChunk: 3 }, 0)).toThrow(
      /an observer whose `onChunk` is not a function \(number\)/
    );
  });

  it('diagnoses an unknown __kind', () => {
    expect(() => assertUseEntry({ __kind: 'middlware' }, 0)).toThrow(
      /an object with `__kind` "middlware" \(expected 'middleware' or 'observer'\)/
    );
  });

  it('diagnoses a symbol `__kind` by name, not the bare text "undefined"', () => {
    // JSON.stringify(aSymbol) returns undefined, which would otherwise render
    // as the literal text "undefined" and hide that a symbol was there.
    const kind = Symbol('middlware');
    expect(() => assertUseEntry({ __kind: kind }, 0)).toThrow(
      /an object with `__kind` Symbol\(middlware\) \(expected 'middleware' or 'observer'\)/
    );
  });

  it('diagnoses an object with no __kind', () => {
    expect(() => assertUseEntry({ fn: noop }, 0)).toThrow(
      /an object with no `__kind`/
    );
  });

  it('diagnoses non-objects', () => {
    expect(() => assertUseEntry(null, 0)).toThrow(/: null\. A `use` entry/);
    expect(() => assertUseEntry(undefined, 0)).toThrow(
      /: undefined\. A `use` entry/
    );
    expect(() => assertUseEntry(noop, 0)).toThrow(/: a function\. A `use`/);
    expect(() => assertUseEntry('guard', 0)).toThrow(
      /: a string \("guard"\)\. A `use`/
    );
    expect(() => assertUseEntry(7, 0)).toThrow(/: a number \(7\)\. A `use`/);
  });
});
