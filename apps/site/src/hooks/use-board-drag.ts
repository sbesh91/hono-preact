import { useRef, useState, useCallback } from 'preact/hooks';
import type { TaskStatus } from '../demo/data.js';

export type ColumnRect = {
  status: TaskStatus;
  rect: { left: number; right: number };
};

// Pure: pick the column whose horizontal band contains x; clamp to edges.
export function dropTargetFromPoint(cols: ColumnRect[], x: number): TaskStatus {
  for (const c of cols) {
    if (x >= c.rect.left && x < c.rect.right) return c.status;
  }
  return x < cols[0].rect.left ? cols[0].status : cols[cols.length - 1].status;
}

const LIFT_SHADOW =
  '0 12px 26px -8px rgba(37,40,42,.28), 0 4px 10px -6px rgba(37,40,42,.18)';

// Build the drag avatar: a clone of the card promoted to the top layer via the
// Popover API, so it floats above the board's `overflow-x-auto` clip (and any
// ancestor stacking/containing-block trap) instead of being cut off as a plain
// in-flow `translate` would be. The clone is inert (pointer-events: none) and
// lives outside Preact's tree, so it cannot perturb the board's diff. Returns
// the popover element to translate + tear down, plus the lift-pop rAF id so the
// caller can cancel it if the drag ends before the pop frame runs.
function createGhost(
  card: HTMLElement,
  rect: DOMRect
): { ghost: HTMLDivElement; raf: number } {
  const ghost = document.createElement('div');
  ghost.setAttribute('popover', 'manual');

  const clone = card.cloneNode(true) as HTMLElement;
  // Drop view-transition-names (and ids) from the clone so it never collides
  // with the real card's names if a navigation view transition fires mid-drag.
  for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
    node.style.removeProperty('view-transition-name');
    node.removeAttribute('id');
  }
  ghost.appendChild(clone);
  document.body.appendChild(ghost);
  ghost.showPopover();

  // Pin to the card's current viewport box and strip the UA [popover] defaults
  // (centering inset/margin, border, padding, the overflow:auto that would clip
  // the lift shadow, the canvas background, and the CanvasText color that would
  // otherwise ignore the app foreground). inset:auto goes first so the explicit
  // left/top win over the UA inset:0.
  Object.assign(ghost.style, {
    position: 'fixed',
    inset: 'auto',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    border: '0',
    padding: '0',
    overflow: 'visible',
    background: 'transparent',
    color: 'var(--foreground)',
    pointerEvents: 'none',
    willChange: 'translate',
  });
  // Under reduced motion, apply the lifted state instantly (no eased pop).
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ghost.style.scale = '1.03';
    ghost.style.boxShadow = LIFT_SHADOW;
    return { ghost, raf: 0 };
  }
  // Otherwise pop the lift in on the next frame so scale + shadow animate from
  // rest (setting them inline at creation has no from-value to ease from).
  ghost.style.transition = 'scale 140ms ease, box-shadow 140ms ease';
  const raf = requestAnimationFrame(() => {
    ghost.style.scale = '1.03';
    ghost.style.boxShadow = LIFT_SHADOW;
  });
  return { ghost, raf };
}

// Demo-only pointer-events drag. NOT a framework primitive. Tracks the
// dragged task id + the hovered column; commits via onDrop on pointerup.
export function useBoardDrag(
  getColumnRects: () => ColumnRect[],
  onDrop: (taskId: string, to: TaskStatus) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const startedRef = useRef(false);

  const onPointerDown = useCallback(
    (taskId: string, e: PointerEvent) => {
      if (e.button !== 0) return; // left only; right-click stays for ContextMenu
      const startX = e.clientX,
        startY = e.clientY;
      const el = e.currentTarget as HTMLElement; // the card wrapper
      startedRef.current = false;
      let ghost: HTMLDivElement | null = null;
      let liftRaf = 0;

      // Listen on window, not the card: the drag must cross into other columns,
      // which moves the pointer off the card. setPointerCapture is unreliable
      // here (it can silently fail), so window listeners are what guarantee we
      // keep receiving pointermove/pointerup through the whole gesture.
      const move = (ev: PointerEvent) => {
        if (!startedRef.current) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          startedRef.current = true;
          setDraggingId(taskId);
          // Lift a clone into the top layer and dim the original in place, so
          // its slot is held and the column never reflows.
          const created = createGhost(el, el.getBoundingClientRect());
          ghost = created.ghost;
          liftRaf = created.raf;
          el.style.opacity = '0.5';
        }
        // Drive the ghost imperatively (no per-move re-render of the board).
        // `translate` is kept out of the ghost's transition so it tracks 1:1.
        if (ghost)
          ghost.style.translate = `${ev.clientX - startX}px ${ev.clientY - startY}px`;
        setOverStatus(dropTargetFromPoint(getColumnRects(), ev.clientX));
      };
      // Drop the lift. Called on every end (commit or abort) so the ghost never
      // gets stuck floating and the source card is always un-dimmed.
      const resetLift = () => {
        el.style.opacity = '';
        if (liftRaf) {
          cancelAnimationFrame(liftRaf);
          liftRaf = 0;
        }
        if (ghost) {
          try {
            ghost.hidePopover();
          } catch {
            /* already hidden */
          }
          ghost.remove();
          ghost = null;
        }
      };
      // finish always tears down all three listeners (so an aborted gesture
      // never leaks listeners that stack onto the next drag). It only commits a
      // drop on a real release (commit=true via pointerup), not on pointercancel
      // (which fires if the browser hijacks the gesture, e.g. a native drag).
      const finish = (commit: boolean, ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        resetLift();
        const dragged = startedRef.current;
        if (commit && dragged) {
          const to = dropTargetFromPoint(getColumnRects(), ev.clientX);
          onDrop(taskId, to);
        }
        if (dragged) {
          // After a drag the browser still fires a synthetic click on whatever
          // is under the pointer (the card itself on a same-column drop). Swallow
          // that one click in the capture phase so the card's link never
          // navigates at the end of a drag. One-shot, with a timeout fallback in
          // case no click follows (e.g. a cross-column drop re-parents the card).
          const swallowClick = (ce: MouseEvent) => {
            // Only swallow the click that lands on the dragged card itself
            // (same-column drop). A cross-column drop re-parents the card so no
            // click targets it, and an unrelated fast click elsewhere within the
            // macrotask window must not be eaten.
            if (!(ce.target instanceof Node) || !el.contains(ce.target)) return;
            ce.preventDefault();
            ce.stopPropagation();
            window.removeEventListener('click', swallowClick, true);
          };
          window.addEventListener('click', swallowClick, true);
          setTimeout(() => {
            window.removeEventListener('click', swallowClick, true);
          }, 0);
        }
        setDraggingId(null);
        setOverStatus(null);
        startedRef.current = false;
      };
      const up = (ev: PointerEvent) => finish(true, ev);
      const cancel = (ev: PointerEvent) => finish(false, ev);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [getColumnRects, onDrop]
  );

  return { draggingId, overStatus, onPointerDown };
}
