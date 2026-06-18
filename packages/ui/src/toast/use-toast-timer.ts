import { useEffect, useRef } from 'preact/hooks';

export interface UseToastTimerOptions {
  id: string | number;
  duration: number; // ms; Infinity = never auto-dismiss
  paused: boolean;
  onExpire: () => void;
}

// Per-toast auto-dismiss timer. Banks elapsed time on pause and resumes with the
// remaining duration so hover/focus/tab-hidden never restart the countdown.
export function useToastTimer(opts: UseToastTimerOptions): void {
  const { id, duration, paused, onExpire } = opts;
  const remaining = useRef(duration);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Reset the budget if the toast's duration changes (e.g. promise resolves).
  useEffect(() => {
    remaining.current = duration;
  }, [duration, id]);

  useEffect(() => {
    if (duration === Infinity) return;

    const clear = () => {
      if (timer.current != null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (paused) {
      if (startedAt.current != null) {
        remaining.current -= Date.now() - startedAt.current;
        startedAt.current = null;
      }
      clear();
      return;
    }

    startedAt.current = Date.now();
    timer.current = setTimeout(
      () => onExpireRef.current(),
      Math.max(0, remaining.current)
    );
    return clear;
  }, [paused, duration, id]);
}
