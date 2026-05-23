import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction timeoutMs', () => {
  it('does not attach timeoutMs when option is omitted', () => {
    const stub = defineAction(async (_ctx, _payload) => 1);
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBeUndefined();
  });

  it('attaches timeoutMs as a non-enumerable property', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: 5000 });
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBe(5000);
    const desc = Object.getOwnPropertyDescriptor(stub, 'timeoutMs');
    expect(desc?.enumerable).toBe(false);
  });

  it('accepts false to disable', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: false });
    expect((stub as { timeoutMs?: unknown }).timeoutMs).toBe(false);
  });
});
