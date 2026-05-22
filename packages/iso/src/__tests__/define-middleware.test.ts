import { describe, it, expect } from 'vitest';
import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '../define-middleware.js';

describe('defineServerMiddleware', () => {
  it('produces a record branded with kind, runs, and fn', () => {
    const mw = defineServerMiddleware(async (_ctx, next) => {
      await next();
    });
    expect(mw.__kind).toBe('middleware');
    expect(mw.runs).toBe('server');
    expect(typeof mw.fn).toBe('function');
  });
});

describe('defineClientMiddleware', () => {
  it('produces a record branded with kind, runs, and fn', () => {
    const mw = defineClientMiddleware(async (_ctx, next) => {
      await next();
    });
    expect(mw.__kind).toBe('middleware');
    expect(mw.runs).toBe('client');
  });

  it('its context has no `c` field at the type level (smoke check at runtime)', async () => {
    let observedKeys: string[] = [];
    const mw = defineClientMiddleware(async (ctx, next) => {
      observedKeys = Object.keys(ctx);
      await next();
    });
    await mw.fn(
      { scope: 'page', location: { path: '/' } as never },
      async () => undefined
    );
    expect(observedKeys).toContain('location');
    expect(observedKeys).not.toContain('c');
  });
});
