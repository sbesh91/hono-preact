import { describe, it, expect } from 'vitest';
import { defineApp } from '../define-app.js';
import { defineServerMiddleware } from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('defineApp', () => {
  it('returns the config unchanged (identity function with type narrowing)', () => {
    const cfg = defineApp({ use: [] });
    expect(cfg.use).toEqual([]);
  });

  it('accepts middleware and observers in the use array', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({ onStart: () => {} });
    const cfg = defineApp({ use: [mw, obs] });
    expect(cfg.use).toHaveLength(2);
  });

  it('use is optional', () => {
    const cfg = defineApp({});
    expect(cfg.use).toBeUndefined();
  });
});
