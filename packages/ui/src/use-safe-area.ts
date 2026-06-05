// packages/ui/src/use-safe-area.ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  buildSafePolygon,
  pointInPolygon,
  pointInRect,
  sideFromRects,
} from './safe-area.js';

export interface UseSafeAreaOptions {
  enabled: boolean; // typically the open state of a hover-driven element
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  onClose: () => void; // intent abandoned, or grace expired
  graceMs?: number; // default 300
}

export function useSafeArea(opts: UseSafeAreaOptions): void {
  const { enabled, anchorRef, floatingRef, onClose, graceMs = 300 } = opts;

  // Forward to the latest onClose without re-subscribing the listener.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // anchorRef/floatingRef are stable RefObjects; depend only on the values that
  // change the listener's behavior. Matches useDismiss's effect shape.
  useLayoutEffect(() => {
    if (!enabled) return;
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    // Per-session state lives in the effect closure (reset on each open).
    let engaged = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearGrace = () => {
      if (graceTimer != null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    };

    const close = () => {
      clearGrace();
      onCloseRef.current();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const point = { x: event.clientX, y: event.clientY };
      const anchorRect = anchor.getBoundingClientRect();
      const floatingRect = floating.getBoundingClientRect();

      // 1. Over a reference element: safely parked, stay open.
      if (pointInRect(point, anchorRect) || pointInRect(point, floatingRect)) {
        engaged = true;
        clearGrace();
        return;
      }

      // 2. No hover session yet (e.g. opened by keyboard focus): ignore, so a
      //    stray mouse move never closes a focus-opened element.
      if (!engaged) return;

      // 3. In the gap: honor the corridor toward the floating element.
      const side = sideFromRects(anchorRect, floatingRect);
      const polygon = buildSafePolygon(anchorRect, floatingRect, side);
      if (pointInPolygon(point, polygon)) {
        if (graceTimer == null) graceTimer = setTimeout(close, graceMs);
        return;
      }
      close();
    };

    document.addEventListener('pointermove', onPointerMove);
    return () => {
      clearGrace();
      document.removeEventListener('pointermove', onPointerMove);
    };
  }, [enabled, graceMs]);
}
