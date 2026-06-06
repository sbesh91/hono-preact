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
  onClose: () => void; // pointer left the safe region and the grace expired
  graceMs?: number; // close grace after leaving the safe region, default 300
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

    // Start the close countdown once the pointer has left the safe region. Arm
    // once: continued movement outside the region keeps the original deadline,
    // and re-entering (clearGrace) cancels it.
    const armGrace = () => {
      if (graceTimer == null) graceTimer = setTimeout(close, graceMs);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      // Read the refs per-move, not once at effect setup. A floating element
      // that mounts on open (e.g. a submenu positioner that mounts after this
      // trigger-side effect has already run) is null at setup but present by
      // the first move. Capturing once would attach the listener with a null
      // floating element, so the element could never close.
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
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

      // 3. Inside the corridor toward the floating element: still in the safe
      //    region, so stay open and cancel any pending close.
      const side = sideFromRects(anchorRect, floatingRect);
      const polygon = buildSafePolygon(anchorRect, floatingRect, side);
      if (pointInPolygon(point, polygon)) {
        clearGrace();
        return;
      }

      // 4. Left the safe region (reference + corridor): start the close grace.
      //    Moving back in before it elapses cancels the close.
      armGrace();
    };

    // The pointer leaving the viewport ends the hover session: no further
    // pointermove will carry it back into the safe region, so a tooltip last
    // seen inside the corridor would otherwise hang open. Start the same grace.
    const onDocumentLeave = () => {
      if (engaged) armGrace();
    };

    const root = document.documentElement;
    document.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onDocumentLeave);
    return () => {
      clearGrace();
      document.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onDocumentLeave);
    };
  }, [enabled, graceMs]);
}
