import { describe, it, expect } from 'vitest';
import { timeoutOutcome, isTimeout, isOutcome } from '../outcomes.js';

describe('timeoutOutcome', () => {
  it('constructs a timeout outcome with the given timeoutMs', () => {
    const o = timeoutOutcome(30000);
    expect(o).toEqual({ __outcome: 'timeout', timeoutMs: 30000 });
  });

  it('isTimeout narrows correctly', () => {
    const o: unknown = timeoutOutcome(5000);
    expect(isTimeout(o)).toBe(true);
    expect(isTimeout({ __outcome: 'deny' })).toBe(false);
    expect(isTimeout(null)).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
  });

  it('isOutcome recognizes timeout', () => {
    expect(isOutcome(timeoutOutcome(1000))).toBe(true);
  });
});
