import { describe, it, expect } from 'vitest';
import {
  clamp01,
  computeProgress,
  sliceProgress,
  barStatus,
  laneCap,
} from '../progress.js';

describe('clamp01', () => {
  it('clamps to the 0..1 range', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe('computeProgress', () => {
  it('is 0 when the stage top is at the viewport top', () => {
    expect(computeProgress(0, 3000, 1000)).toBe(0);
  });
  it('is 1 exactly when the pin releases, not before', () => {
    // stage 3000, pin 1000: the sticky pin travels 2000px before its bottom edge
    // catches the stage's bottom edge, so the scrub range is 2000.
    expect(computeProgress(-2000, 3000, 1000)).toBe(1);
  });
  it('is 0.5 at the midpoint and never divides by zero', () => {
    expect(computeProgress(-1000, 3000, 1000)).toBe(0.5);
    expect(computeProgress(-10, 1000, 1000)).toBe(1); // range guarded to >= 1
  });
  it('shortens the scrub range as the denominator grows', () => {
    // Plain range arithmetic, and deliberately NOT named as the regression test
    // for the iOS pin bug: this function's body is unchanged, and it always
    // divided by whatever it was handed. The defect was the *argument* the
    // driver passed (window.innerHeight instead of the pin's height), so only a
    // test that observes the driver can catch it. That lives in driver.test.tsx
    // ("scrubs against the pin, not the window"), and this case would happily
    // pass against the buggy build.
    const stage = 2235; // 3 pages x 745svh
    expect(computeProgress(-1400, stage, 745)).toBeCloseTo(0.9396, 3);
    expect(computeProgress(-1400, stage, 852)).toBe(1);
  });
});

describe('sliceProgress', () => {
  it('re-normalizes a sub-window to local 0..1', () => {
    expect(sliceProgress(0.5, 0.25, 0.75)).toBe(0.5);
    expect(sliceProgress(0.2, 0.25, 0.75)).toBe(0);
    expect(sliceProgress(0.9, 0.25, 0.75)).toBe(1);
  });
});

describe('barStatus', () => {
  it('reports idle, in-flight, then done as the playhead crosses [start, start+size]', () => {
    expect(barStatus(0, 0.2, 0.4)).toBe('idle');
    expect(barStatus(0.4, 0.2, 0.4)).toBe('inflight');
    expect(barStatus(0.7, 0.2, 0.4)).toBe('done');
  });
  it('flags cancel once past cancelAt, and not before', () => {
    expect(barStatus(0.9, 0.2, 0.4, 0.4)).toBe('cancel');
    expect(barStatus(0.3, 0.2, 0.4, 0.4)).toBe('inflight');
  });
  it('cancels exactly at cancelAt, not one frame later', () => {
    // The boundary is `>=`: pin it, or `>` passes every other case in this file.
    expect(barStatus(0.4, 0.2, 0.4, 0.4)).toBe('cancel');
  });
});

describe('laneCap', () => {
  it('is 1 for a lane that runs to completion', () => {
    expect(laneCap(0.2, 0.4)).toBe(1);
  });
  it('is the width a cancelled lane freezes at', () => {
    // Cancelled halfway through its own window: (0.4 - 0.2) / 0.4. The CSS caps
    // the fill at this, which is all "freeze on cancel" has to mean for a bar
    // that only ever grows with the playhead.
    expect(laneCap(0.2, 0.4, 0.4)).toBeCloseTo(0.5);
  });
  it('never exceeds the track', () => {
    expect(laneCap(0.2, 0.1, 0.9)).toBe(1);
  });
});
