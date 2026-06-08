import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type PresenceStatus = 'open' | 'closing' | 'closed';

export interface UsePresenceOptions {
  // Fires when the exit animation resolves, immediately before isPresent flips
  // false. Dialog passes close() here so native focus return runs before unmount.
  onExitComplete?: () => void;
  // Hard cap (ms) on the exit-timeout race; guards a stuck or under-reported
  // animation, or a backgrounded tab. Default 3000.
  timeoutCap?: number;
}

export interface UsePresenceResult {
  // Render the element while true (open OR animating out).
  isPresent: boolean;
  // 'open' | 'closing' | 'closed'. Map to data-state: closing -> "closed".
  status: PresenceStatus;
  // Attach to the element carrying the exit transition. Merge with the
  // component's own ref via mergeRefs.
  ref: (node: Element | null) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function exitTimeout(animations: Animation[], cap: number): number {
  let max = 0;
  for (const a of animations) {
    const timing = a.effect?.getComputedTiming();
    const end = typeof timing?.endTime === 'number' ? timing.endTime : 0;
    if (end > max) max = end;
  }
  return Math.min(max > 0 ? max + 100 : cap, cap);
}

export function usePresence(
  present: boolean,
  options: UsePresenceOptions = {}
): UsePresenceResult {
  const { onExitComplete, timeoutCap = 3000 } = options;

  const [status, setStatus] = useState<PresenceStatus>(
    present ? 'open' : 'closed'
  );

  const nodeRef = useRef<Element | null>(null);
  const prevPresent = useRef(present);
  const genRef = useRef(0);

  // Keep the latest callback/cap without re-running the exit effect.
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;
  const timeoutCapRef = useRef(timeoutCap);
  timeoutCapRef.current = timeoutCap;

  const ref = useCallback((node: Element | null) => {
    nodeRef.current = node;
  }, []);

  // React to present transitions. On first mount prevPresent === present, so
  // this never produces a 'closing' on the initial render (no exit on mount/SSR).
  useLayoutEffect(() => {
    if (present === prevPresent.current) return;
    prevPresent.current = present;
    genRef.current++;
    setStatus(present ? 'open' : 'closing');
  }, [present]);

  // Entering 'closing' runs this AFTER the data-state=closed render commits, so
  // the exit animation is live in the DOM when we read it.
  useLayoutEffect(() => {
    if (status !== 'closing') return;
    const myGen = genRef.current;
    const node = nodeRef.current;
    let finalized = false;

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      if (genRef.current !== myGen) return; // reopened mid-exit; abandon
      onExitCompleteRef.current?.();
      setStatus('closed');
    };

    if (
      !node ||
      typeof node.getAnimations !== 'function' ||
      prefersReducedMotion()
    ) {
      finalize();
      return;
    }

    // Forced reflow so the just-applied closed-state styles register as an
    // animation/transition. Use getBoundingClientRect (Element) to avoid a cast;
    // never rAF (throttled/paused in background tabs).
    node.getBoundingClientRect();

    const animations = node
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);

    if (animations.length === 0) {
      finalize();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = animations.length;

    const onSettled = () => {
      remaining--;
      if (remaining === 0) {
        if (timer !== undefined) clearTimeout(timer);
        finalize();
      }
    };

    timer = setTimeout(
      () => {
        finalize();
      },
      exitTimeout(animations, timeoutCapRef.current)
    );

    for (const a of animations) {
      a.finished.then(onSettled, onSettled);
    }

    return () => {
      finalized = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [status]);

  return {
    isPresent: present || status === 'closing',
    status,
    ref,
  };
}
