import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

// `timeoutMs` is attached as ambient non-enumerable metadata, not on the
// public `ActionStub` type. Reading it through the property descriptor keeps
// the assertion honest about what the implementation does (and avoids
// asserting against a phantom field on the typed surface).
function readAmbient(stub: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(stub, key)?.value;
}

describe('defineAction timeoutMs', () => {
  it('does not attach timeoutMs when option is omitted', () => {
    const stub = defineAction(async (_ctx, _payload) => 1);
    expect(readAmbient(stub, 'timeoutMs')).toBeUndefined();
  });

  it('attaches timeoutMs as a non-enumerable property', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: 5000 });
    const desc = Object.getOwnPropertyDescriptor(stub, 'timeoutMs');
    expect(desc?.value).toBe(5000);
    expect(desc?.enumerable).toBe(false);
  });

  it('accepts false to disable', () => {
    const stub = defineAction(async (_ctx, _payload) => 1, { timeoutMs: false });
    expect(readAmbient(stub, 'timeoutMs')).toBe(false);
  });
});
