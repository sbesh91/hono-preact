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

  // Run the exit when we enter 'closing'. The element that actually animates is
  // often a CHILD of the ref'd node whose `data-state` flips a render-tick later
  // (it is consumer/context-driven), so an empty animation set on the first
  // synchronous read does NOT mean "no exit animation". We read synchronously
  // first (covers the native-dialog case, where the animated element IS the
  // ref'd element); if empty, we wait briefly for a transition/animation to
  // START (transitionrun/animationstart bubble up from the child) before
  // concluding there is none.
  useLayoutEffect(() => {
    if (status !== 'closing') return;
    const myGen = genRef.current;
    const node = nodeRef.current;
    let finalized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      node?.removeEventListener('transitionrun', onStart);
      node?.removeEventListener('animationstart', onStart);
    };

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      cleanup();
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

    const getActive = (): Animation[] =>
      node
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);

    const awaitAll = (animations: Animation[]) => {
      cleanup(); // drop the start-listeners and the no-animation fallback timer
      if (finalized) return;
      let remaining = animations.length;
      const onSettled = () => {
        remaining--;
        if (remaining === 0) finalize();
      };
      timer = setTimeout(
        finalize,
        exitTimeout(animations, timeoutCapRef.current)
      );
      for (const a of animations) a.finished.then(onSettled, onSettled);
    };

    function onStart() {
      const active = getActive();
      if (active.length > 0) awaitAll(active);
    }

    // Forced reflow so any already-applied closed-state styles register, then
    // read. getBoundingClientRect (Element) avoids a cast; never rAF (paused in
    // background tabs).
    node.getBoundingClientRect();
    const initial = getActive();
    if (initial.length > 0) {
      awaitAll(initial);
    } else {
      // Nothing is running yet: the animated child may flip `data-state` a tick
      // after this effect. Wait for a transition/animation to start; if none
      // does shortly, there is no exit animation, so finalize.
      node.addEventListener('transitionrun', onStart);
      node.addEventListener('animationstart', onStart);
      timer = setTimeout(finalize, 100);
    }

    // Cleanup on reopen/unmount: finalize is generation-guarded (it will not
    // fire onExitComplete / setStatus once the generation advanced on reopen)
    // and tears down the listeners + timer.
    return finalize;
  }, [status]);

  return {
    // `status !== 'closed'` (not `=== 'closing'`): the closing transition is set
    // in a layout effect that runs AFTER the close render commits, so on that
    // first `present === false` render `status` is still 'open'. Keying off
    // 'closing' would drop isPresent false for that one committed render,
    // unmounting / `display:none`-ing the element and cancelling its exit
    // animation (the always-mounted Select/Combobox never animated; the others
    // only survived via a wasteful unmount/remount). Staying present until
    // 'closed' keeps the element rendered continuously so a transition/animation
    // on the `data-state` flip plays.
    isPresent: present || status !== 'closed',
    status,
    ref,
  };
}
