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
      const el = e.currentTarget as HTMLElement;
      startedRef.current = false;

      const move = (ev: PointerEvent) => {
        if (!startedRef.current) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          startedRef.current = true;
          setDraggingId(taskId);
          try {
            el.setPointerCapture(ev.pointerId);
          } catch {
            /* ignore */
          }
        }
        setOverStatus(dropTargetFromPoint(getColumnRects(), ev.clientX));
      };
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (startedRef.current) {
          const to = dropTargetFromPoint(getColumnRects(), ev.clientX);
          onDrop(taskId, to);
        }
        setDraggingId(null);
        setOverStatus(null);
        startedRef.current = false;
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    },
    [getColumnRects, onDrop]
  );

  return { draggingId, overStatus, onPointerDown };
}
