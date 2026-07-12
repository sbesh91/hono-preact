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
  it('measures the pin, so a collapsing mobile URL bar cannot saturate it early', () => {
    // The regression this guards: the pin is sized in svh (the small viewport,
    // toolbar showing), but window.innerHeight grows toward lvh as the URL bar
    // collapses. Measuring the window instead of the pin shortens the range, so
    // the playhead reaches 1 while the scene is still pinned and the last
    // stretch of the scrub sits frozen on an already-finished scene.
    const stage = 2235; // 3 pages x 745svh, an iPhone-sized small viewport
    const pin = 745; // 100svh
    const innerHeightOnceToolbarCollapses = 852; // ~lvh

    // Correct: still mid-scrub, ~90px of pin left to run.
    const honest = computeProgress(-1400, stage, pin);
    expect(honest).toBeCloseTo(0.9396, 3);
    expect(honest).toBeLessThan(1);

    // Wrong: the very same scroll position reads as finished.
    expect(computeProgress(-1400, stage, innerHeightOnceToolbarCollapses)).toBe(
      1
    );
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
