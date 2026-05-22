import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';
import { defineServerMiddleware } from '../define-middleware.js';

describe('defineAction(use)', () => {
  it('accepts a use array of action-scope middleware', () => {
    const mw = defineServerMiddleware<'action'>(async (_c, next) => {
      await next();
    });
    const stub = defineAction(async () => ({ ok: true }), { use: [mw] });
    expect((stub as unknown as { use: unknown[] }).use).toEqual([mw]);
  });

  it('continues to accept (fn) without opts (no-opts call signature)', () => {
    const stub = defineAction(async () => ({ ok: true }));
    expect(stub).toBeDefined();
    expect((stub as unknown as { use?: unknown }).use).toBeUndefined();
  });
});
