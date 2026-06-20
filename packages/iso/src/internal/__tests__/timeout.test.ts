import { describe, it, expect } from 'vitest';
import { validateTimeoutMs, timeoutMessage } from '../timeout.js';

describe('validateTimeoutMs', () => {
  it('accepts undefined, false, and non-negative finite numbers', () => {
    expect(() => validateTimeoutMs(undefined, 'ctx')).not.toThrow();
    expect(() => validateTimeoutMs(false, 'ctx')).not.toThrow();
    expect(() => validateTimeoutMs(0, 'ctx')).not.toThrow();
    expect(() => validateTimeoutMs(30_000, 'ctx')).not.toThrow();
  });

  it('rejects negative, NaN, and infinite values with a RangeError naming the context', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateTimeoutMs(bad, 'defineLoader')).toThrowError(
        /defineLoader: timeoutMs must be a non-negative finite number or false/
      );
    }
  });
});

describe('timeoutMessage', () => {
  it('formats the canonical timed-out wording', () => {
    expect(timeoutMessage(5000)).toBe('Request timed out after 5000ms');
  });
});
