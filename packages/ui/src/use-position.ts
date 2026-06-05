// packages/ui/src/use-position.ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  computePosition,
  autoUpdate,
  offset as offsetMiddleware,
  flip,
  shift,
  arrow as arrowMiddleware,
  type Placement,
  type VirtualElement,
  type ClientRectObject,
} from '@floating-ui/dom';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

// A rect-getter for positioning against a point or virtual element. Lets other
// modules (e.g. the context menu) name the option type without importing
// floating-ui directly.
export type ClientRectGetter = () => ClientRectObject | null;

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

function defaultRect(): ClientRectObject {
  return {
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  };
}

export interface UsePositionOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  arrowRef?: RefObject<HTMLElement>;
  // When provided, positions against this rect (a floating-ui virtual element)
  // instead of anchorRef.current. Used by the context menu to anchor at the
  // pointer. Returning null yields a zero rect at the origin (defaultRect), so
  // computePosition always receives a valid reference.
  getAnchorRect?: ClientRectGetter;
  side?: Side; // default 'bottom'
  align?: Align; // default 'center'
  offset?: number; // gap in px, default 8
}

export interface PositionState {
  side: Side;
  align: Align;
  arrowX: number | null;
  arrowY: number | null;
}

export function usePosition(opts: UsePositionOptions): PositionState {
  const {
    open,
    anchorRef,
    floatingRef,
    arrowRef,
    getAnchorRect,
    side = 'bottom',
    align = 'center',
    offset = 8,
  } = opts;

  const [state, setState] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  // Keep the latest state in a ref so the autoUpdate callback can skip
  // setState when nothing the render cares about changed (it fires on every
  // scroll/resize frame; we only re-render on a side/align/arrow change).
  const stateRef = useRef(state);
  stateRef.current = state;

  useLayoutEffect(() => {
    const floating = floatingRef.current;
    if (!open || !floating) return;
    const virtual: VirtualElement | null = getAnchorRect
      ? { getBoundingClientRect: () => getAnchorRect() ?? defaultRect() }
      : null;
    const reference: HTMLElement | VirtualElement | null =
      virtual ?? anchorRef.current;
    if (!reference) return;

    // computePosition is async; guard its resolution so a promise still in
    // flight when the effect tears down (the floating element unmounted) does
    // not write to a detached node or setState on an unmounted component.
    let cancelled = false;

    const update = () => {
      const middleware = [
        offsetMiddleware(offset),
        flip(),
        shift({ padding: 8 }),
      ];
      if (arrowRef?.current) {
        middleware.push(arrowMiddleware({ element: arrowRef.current }));
      }
      computePosition(reference, floating, {
        strategy: 'fixed',
        placement: placementFor(side, align),
        middleware,
      }).then(({ x, y, placement, middlewareData }) => {
        if (cancelled) return;
        floating.style.position = 'fixed';
        floating.style.left = `${x}px`;
        floating.style.top = `${y}px`;

        const resolved = sideAlignFromPlacement(placement);
        const arrowData = middlewareData.arrow;
        const next: PositionState = {
          side: resolved.side,
          align: resolved.align,
          arrowX: arrowData?.x ?? null,
          arrowY: arrowData?.y ?? null,
        };
        const prev = stateRef.current;
        if (
          prev.side !== next.side ||
          prev.align !== next.align ||
          prev.arrowX !== next.arrowX ||
          prev.arrowY !== next.arrowY
        ) {
          setState(next);
        }
      });
    };

    const stopAutoUpdate = autoUpdate(reference, floating, update);
    return () => {
      cancelled = true;
      stopAutoUpdate();
    };
    // anchorRef/floatingRef/arrowRef are stable RefObjects; depend on the
    // values that change the computation.
  }, [open, side, align, offset, getAnchorRect]);

  return state;
}
