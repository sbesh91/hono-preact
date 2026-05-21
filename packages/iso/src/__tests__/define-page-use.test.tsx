import { describe, it, expect } from 'vitest';
import { definePage } from '../define-page.js';
import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '../define-middleware.js';
import { defineStreamObserver } from '../define-stream-observer.js';

describe('definePage(use)', () => {
  it('accepts a `use` array of mixed middleware and observers without error', () => {
    const mw = defineServerMiddleware(async (_c, next) => {
      await next();
    });
    const clientMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const obs = defineStreamObserver({ onStart: () => {} });
    const Component = () => null;
    const PageRoute = definePage(Component, { use: [mw, clientMw, obs] });
    expect(typeof PageRoute).toBe('function');
  });
});
