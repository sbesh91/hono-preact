import { describe, it, expect } from 'vitest';
import { partitionUse } from '../use-partitioner.js';
import { defineServerMiddleware } from '../../define-middleware.js';
import { defineStreamObserver } from '../../define-stream-observer.js';

describe('partitionUse', () => {
  it('returns empty arrays for an empty input', () => {
    const { middleware, observers } = partitionUse([]);
    expect(middleware).toEqual([]);
    expect(observers).toEqual([]);
  });

  it('splits middleware from observers, preserving relative order within each kind', () => {
    const mw1 = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs1 = defineStreamObserver({ onStart: () => {} });
    const mw2 = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs2 = defineStreamObserver({ onEnd: () => {} });

    const { middleware, observers } = partitionUse([mw1, obs1, mw2, obs2]);
    expect(middleware).toEqual([mw1, mw2]);
    expect(observers).toEqual([obs1, obs2]);
  });

  it('throws on an entry it cannot classify instead of bucketing it as an observer', () => {
    // The fail-open this validation closes: a malformed middleware used to
    // land in the observer bucket, and observers cannot deny.
    expect(() => partitionUse([{ __kind: 'middlware' }])).toThrow(
      /Invalid `use` entry at index 0: an object with `__kind` "middlware"/
    );
  });

  it('throws on a middleware whose `runs` would fail the server filter', () => {
    expect(() =>
      partitionUse([{ __kind: 'middleware', runs: 'sever', fn: () => {} }])
    ).toThrow(/a middleware whose `runs` is "sever"/);
  });

  it('throws on a middleware with no `fn`', () => {
    expect(() =>
      partitionUse([{ __kind: 'middleware', runs: 'server' }])
    ).toThrow(/a middleware whose `fn` is not a function \(undefined\)/);
  });

  it('throws on null, undefined, and a bare function', () => {
    expect(() => partitionUse([null])).toThrow(/: null\./);
    expect(() => partitionUse([undefined])).toThrow(/: undefined\./);
    expect(() => partitionUse([() => {}])).toThrow(/: a function\./);
  });

  it('reports the position of a bad entry that is not first, and the source label', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({});
    expect(() =>
      partitionUse([mw, obs, null], 'the app-level `use`')
    ).toThrow(/Invalid `use` entry at index 2 of the app-level `use`: null\./);
  });

  it('rejects a bad entry even when valid middleware follows it', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    expect(() => partitionUse([null, mw])).toThrow(/index 0/);
  });
});
