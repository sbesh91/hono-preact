import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction', () => {
  it('returns the function unchanged at runtime', () => {
    const fn = async (_ctx: unknown, _payload: { name: string }) => ({ ok: true });
    const stub = defineAction(fn);
    expect(stub).toBe(fn as unknown);
  });
});
