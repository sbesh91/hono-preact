import { describe, it, expect } from 'vitest';
import { rampAmplitude, AMP_RAMP_MS } from '../shader-anim.ts';

describe('rampAmplitude', () => {
  it('returns full amplitude immediately when reduced motion is set', () => {
    expect(rampAmplitude(0, true)).toBe(1);
    expect(rampAmplitude(10_000, true)).toBe(1);
  });

  it('starts at zero so the first animated frame is a flat palette blend', () => {
    expect(rampAmplitude(0, false)).toBe(0);
  });

  it('eases linearly across the ramp window', () => {
    expect(rampAmplitude(AMP_RAMP_MS / 2, false)).toBeCloseTo(0.5, 5);
  });

  it('clamps to full amplitude at and past the ramp window', () => {
    expect(rampAmplitude(AMP_RAMP_MS, false)).toBe(1);
    expect(rampAmplitude(AMP_RAMP_MS * 3, false)).toBe(1);
  });

  it('treats negative elapsed time as zero amplitude', () => {
    expect(rampAmplitude(-50, false)).toBe(0);
  });

  it('honors a custom ramp window', () => {
    expect(rampAmplitude(100, false, 200)).toBeCloseTo(0.5, 5);
  });
});
