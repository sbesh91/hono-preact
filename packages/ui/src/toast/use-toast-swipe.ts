import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ToastPosition } from './toast-store.js';

// Drag distance (px) past which a release dismisses the toast.
const SWIPE_THRESHOLD = 45;

type Axis = 'x' | 'y';

// Which way a toast is swiped to dismiss, given the region corner. Right-anchored
// toasts swipe right (+x); left-anchored swipe left (-x); centered toasts swipe
// toward their nearest edge (down for bottom, up for top).
function axisAndSign(position: ToastPosition): { axis: Axis; sign: number } {
  if (position.endsWith('right')) return { axis: 'x', sign: 1 };
  if (position.endsWith('left')) return { axis: 'x', sign: -1 };
  return { axis: 'y', sign: position.startsWith('top') ? -1 : 1 };
}

export interface UseToastSwipeOptions {
  position: ToastPosition;
  onDismiss: () => void;
  disabled?: boolean;
}

export interface UseToastSwipeResult {
  swiping: boolean;
  amount: number;
  handlers: Pick<
    JSX.HTMLAttributes<HTMLElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >;
}

export function useToastSwipe(opts: UseToastSwipeOptions): UseToastSwipeResult {
  const { position, onDismiss, disabled = false } = opts;
  const [swiping, setSwiping] = useState(false);
  const [amount, setAmount] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const { axis, sign } = axisAndSign(position);

  const delta = (event: { clientX: number; clientY: number }) => {
    if (!start.current) return 0;
    const raw =
      axis === 'x'
        ? event.clientX - start.current.x
        : event.clientY - start.current.y;
    // Only motion toward the dismiss direction counts; clamp the rest to 0.
    return Math.max(0, raw * sign);
  };

  const onPointerDown = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    // Do not start a swipe from an interactive control (the close/action
    // buttons, links, or form fields). Pointer-capturing the toast here would
    // swallow that control's own click. `[data-no-swipe]` is an explicit opt-out
    // for any other element a consumer wants to keep interactive.
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'button, a, input, select, textarea, label, [data-no-swipe]'
      )
    ) {
      return;
    }
    start.current = { x: event.clientX, y: event.clientY };
    setSwiping(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    setAmount(delta(event));
  };

  const finish = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    const moved = delta(event);
    start.current = null;
    setSwiping(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved >= SWIPE_THRESHOLD) {
      // Dismiss: keep the swipe offset so the exit transition continues outward
      // from where the pointer left, instead of snapping back to center first.
      onDismiss();
    } else {
      // Below threshold: snap back to rest.
      setAmount(0);
    }
  };

  return {
    swiping,
    amount,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
