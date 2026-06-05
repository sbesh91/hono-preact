// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  pointInRect,
  pointInPolygon,
  sideFromRects,
  buildSafePolygon,
} from '../safe-area.js';

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

describe('pointInRect', () => {
  const r = rect(0, 0, 100, 50);
  it('is true inside, false outside', () => {
    expect(pointInRect({ x: 50, y: 25 }, r)).toBe(true);
    expect(pointInRect({ x: 150, y: 25 }, r)).toBe(false);
    expect(pointInRect({ x: 50, y: 80 }, r)).toBe(false);
  });
  it('is inclusive on the edges and corners', () => {
    expect(pointInRect({ x: 0, y: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 100, y: 50 }, r)).toBe(true);
    expect(pointInRect({ x: 100, y: 25 }, r)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  // The right-opening corridor between anchor(0,0,100,50) and
  // floating(200,0,100,150).
  const corridor = [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 150 },
    { x: 100, y: 50 },
  ];
  it('is true for a point inside the corridor', () => {
    expect(pointInPolygon({ x: 150, y: 25 }, corridor)).toBe(true);
  });
  it('is false for a point below the corridor', () => {
    expect(pointInPolygon({ x: 150, y: 130 }, corridor)).toBe(false);
  });
  it('is false for a point left of the corridor', () => {
    expect(pointInPolygon({ x: 50, y: 25 }, corridor)).toBe(false);
  });
});

describe('sideFromRects', () => {
  const anchor = rect(0, 0, 100, 50);
  it('detects right', () => {
    expect(sideFromRects(anchor, rect(200, 0, 100, 150))).toBe('right');
  });
  it('detects left', () => {
    expect(sideFromRects(anchor, rect(-200, 0, 100, 50))).toBe('left');
  });
  it('detects bottom', () => {
    expect(sideFromRects(anchor, rect(0, 100, 100, 80))).toBe('bottom');
  });
  it('detects top', () => {
    expect(sideFromRects(anchor, rect(0, -120, 100, 50))).toBe('top');
  });
  it('breaks an exact diagonal tie toward the horizontal axis', () => {
    expect(sideFromRects(anchor, rect(100, 75, 100, 100))).toBe('right');
  });
});

describe('buildSafePolygon', () => {
  const anchor = rect(0, 0, 100, 50);
  it('joins the near edges for a right-opening floating element', () => {
    expect(buildSafePolygon(anchor, rect(200, 0, 100, 150), 'right')).toEqual([
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 100, y: 50 },
    ]);
  });
  it('joins the near edges for a bottom-opening floating element', () => {
    expect(buildSafePolygon(anchor, rect(0, 100, 100, 80), 'bottom')).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });
  it('joins the near edges for a left-opening floating element', () => {
    expect(buildSafePolygon(anchor, rect(-200, 0, 100, 50), 'left')).toEqual([
      { x: 0, y: 0 },
      { x: -100, y: 0 },
      { x: -100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });
  it('joins the near edges for a top-opening floating element', () => {
    expect(buildSafePolygon(anchor, rect(0, -120, 100, 50), 'top')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: -70 },
      { x: 0, y: -70 },
    ]);
  });
});
