// packages/ui/src/safe-area.ts
//
// Pure geometry for the pointer "safe area" (a quad spanning the gap from a
// trigger's near edge to a floating element's near edge). No DOM, no Preact.
import type { Side } from './use-position.js';

export interface Point {
  x: number;
  y: number;
}

// Inclusive rectangle containment.
export function pointInRect(point: Point, rect: DOMRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

// Even-odd ray cast. Winding order does not matter; the polygon must be simple.
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Which side of the anchor the floating element sits on, from the dominant axis
// of center separation. Derived live so a usePosition flip is honored. An exact
// diagonal tie (|dx| === |dy|) resolves to the horizontal axis.
export function sideFromRects(anchor: DOMRect, floating: DOMRect): Side {
  const dx =
    (floating.left + floating.right) / 2 - (anchor.left + anchor.right) / 2;
  const dy =
    (floating.top + floating.bottom) / 2 - (anchor.top + anchor.bottom) / 2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

// The safe quad: the anchor's near edge joined to the floating element's near
// edge. `side` selects which edges are "near". Points are returned in boundary
// order so the quad is simple (non-self-intersecting).
export function buildSafePolygon(
  anchor: DOMRect,
  floating: DOMRect,
  side: Side
): Point[] {
  switch (side) {
    case 'right':
      return [
        { x: anchor.right, y: anchor.top },
        { x: floating.left, y: floating.top },
        { x: floating.left, y: floating.bottom },
        { x: anchor.right, y: anchor.bottom },
      ];
    case 'left':
      return [
        { x: anchor.left, y: anchor.top },
        { x: floating.right, y: floating.top },
        { x: floating.right, y: floating.bottom },
        { x: anchor.left, y: anchor.bottom },
      ];
    case 'bottom':
      return [
        { x: anchor.left, y: anchor.bottom },
        { x: anchor.right, y: anchor.bottom },
        { x: floating.right, y: floating.top },
        { x: floating.left, y: floating.top },
      ];
    case 'top':
      return [
        { x: anchor.left, y: anchor.top },
        { x: anchor.right, y: anchor.top },
        { x: floating.right, y: floating.bottom },
        { x: floating.left, y: floating.bottom },
      ];
  }
}
