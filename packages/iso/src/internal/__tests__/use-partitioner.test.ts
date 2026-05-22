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
});
