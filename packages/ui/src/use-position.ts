// packages/ui/src/use-position.ts
import type { Placement } from '@floating-ui/dom';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

// Our (side, align) maps to a floating-ui Placement: center is the bare side,
// start/end become the `-start` / `-end` suffix. After the center early-return,
// align narrows to 'start' | 'end', so the template literal is structurally a
// Placement with no cast.
export function placementFor(side: Side, align: Align): Placement {
  if (align === 'center') return side;
  return `${side}-${align}`;
}

// The resolved placement (after flip/shift may have changed it) maps back to
// our side/align so parts can render data-side / data-align. Each branch
// returns a literal, so side/align are inferred as Side/Align with no cast
// (splitting a Placement string would widen the parts back to string).
export function sideAlignFromPlacement(placement: Placement): {
  side: Side;
  align: Align;
} {
  const side: Side = placement.startsWith('top')
    ? 'top'
    : placement.startsWith('bottom')
      ? 'bottom'
      : placement.startsWith('left')
        ? 'left'
        : 'right';
  const align: Align = placement.endsWith('-start')
    ? 'start'
    : placement.endsWith('-end')
      ? 'end'
      : 'center';
  return { side, align };
}
