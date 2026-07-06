import { describe, it, expect } from 'vitest';
import {
  clamp01,
  computeProgress,
  sliceProgress,
  barState,
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
  it('is 1 when scrolled one viewport short of the stage bottom', () => {
    // stageHeight 3000, viewport 1000 -> scrub range 2000; rectTop -2000 -> 1
    expect(computeProgress(-2000, 3000, 1000)).toBe(1);
  });
  it('is 0.5 at the midpoint and never divides by zero', () => {
    expect(computeProgress(-1000, 3000, 1000)).toBe(0.5);
    expect(computeProgress(-10, 1000, 1000)).toBe(1); // range guarded to >= 1
  });
});

describe('sliceProgress', () => {
  it('re-normalizes a sub-window to local 0..1', () => {
    expect(sliceProgress(0.5, 0.25, 0.75)).toBe(0.5);
    expect(sliceProgress(0.2, 0.25, 0.75)).toBe(0);
    expect(sliceProgress(0.9, 0.25, 0.75)).toBe(1);
  });
});

describe('barState', () => {
  it('reports idle, in-flight, then done as the playhead crosses [start, start+size]', () => {
    expect(barState(0, 0.2, 0.4).state).toBe('idle');
    expect(barState(0.4, 0.2, 0.4)).toEqual({ width: 0.5, state: 'inflight' });
    expect(barState(0.7, 0.2, 0.4).state).toBe('done');
  });
  it('freezes width and flags cancel once past cancelAt', () => {
    const s = barState(0.9, 0.2, 0.4, 0.4);
    expect(s.state).toBe('cancel');
    expect(s.width).toBeCloseTo(0.5); // frozen at (0.4-0.2)/0.4
  });
});
