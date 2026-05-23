import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader timeoutMs', () => {
  it('defaults timeoutMs to undefined when not specified', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.timeoutMs).toBeUndefined();
  });

  it('stores the provided timeoutMs on the ref', () => {
    const ref = defineLoader(async () => 1, { timeoutMs: 5000 });
    expect(ref.timeoutMs).toBe(5000);
  });

  it('accepts false to disable', () => {
    const ref = defineLoader(async () => 1, { timeoutMs: false });
    expect(ref.timeoutMs).toBe(false);
  });
});
