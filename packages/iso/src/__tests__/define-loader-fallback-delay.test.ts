import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';

describe('defineLoader fallbackDelay', () => {
  it('defaults fallbackDelay to undefined when not specified', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.fallbackDelay).toBeUndefined();
  });

  it('stores the provided fallbackDelay on the ref', () => {
    const ref = defineLoader(async () => 1, { fallbackDelay: 250 });
    expect(ref.fallbackDelay).toBe(250);
  });

  it('accepts 0 (shows the fallback immediately)', () => {
    const ref = defineLoader(async () => 1, { fallbackDelay: 0 });
    expect(ref.fallbackDelay).toBe(0);
  });

  it('rejects negative numbers', () => {
    expect(() => defineLoader(async () => 1, { fallbackDelay: -1 })).toThrow(
      RangeError
    );
  });

  it('rejects NaN', () => {
    expect(() =>
      defineLoader(async () => 1, { fallbackDelay: Number.NaN })
    ).toThrow(RangeError);
  });

  it('rejects Infinity', () => {
    expect(() =>
      defineLoader(async () => 1, { fallbackDelay: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
  });
});
