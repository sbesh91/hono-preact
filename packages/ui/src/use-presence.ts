import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type PresenceStatus = 'open' | 'closing' | 'closed';

export interface UsePresenceOptions {
  // Fires when the exit resolves, immediately before isPresent flips false.
  // Dialog passes close() here so native focus return runs before unmount.
  // Intentionally argument-less; if a "why did it finalize" reason is ever
  // wanted, add it as an optional arg (non-breaking for existing callers).
  onExitComplete?: () => void;
  // Hard cap (ms) on the wait once an exit animation is RUNNING; guards a stuck
  // or under-reported animation, or a backgrounded tab. Default 3000. It does
  // not bound the separate, shorter wait for an animation to START
  // (NO_ANIMATION_FALLBACK_MS).
  timeoutCap?: number;
}

export interface UsePresenceResult {
  // Render the element while true (open OR animating out).
  isPresent: boolean;
  // 'open' | 'closing' | 'closed'. Map to a data-state attribute, collapsing
  // closing+closed to "closed". Mapping your own open flag is equivalent (during
  // closing the element is logically closed); the library's own components do
  // that. `status` is here for consumers who want to react to the closing phase.
  status: PresenceStatus;
  // Attach to the element carrying the exit animation, OR an ancestor of it
  // (reads use getAnimations({ subtree: true })) — never a sibling. Merge with
  // the component's own ref via mergeRefs.
  ref: (node: Element | null) => void;
}

// How long to wait for an exit transition/animation to START before concluding
// there is none. The animated element is often a child that flips its
// data-state a render-tick after this hook's effect runs, so an empty first
// read is not proof of "no exit". This is a "did anything start?" detector, NOT
// an animation timer, and is unrelated to timeoutCap. Erring high avoids
// silently skipping the exit on a slow commit; it only delays teardown when
// there is genuinely no exit animation.
const NO_ANIMATION_FALLBACK_MS = 250;
// Grace added to the longest running animation's end time before the safety cap.
const TIMEOUT_SLACK_MS = 100;
const DEFAULT_TIMEOUT_CAP_MS = 3000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// Longest end time across the given animations + slack, capped. Assumes
// infinite-iteration animations are already filtered out.
function exitTimeout(animations: Animation[], cap: number): number {
  let max = 0;
  for (const a of animations) {
    const timing = a.effect?.getComputedTiming();
    const end = typeof timing?.endTime === 'number' ? timing.endTime : 0;
    if (end > max) max = end;
  }
  return Math.min(max > 0 ? max + TIMEOUT_SLACK_MS : cap, cap);
}

export function usePresence(
  present: boolean,
  options: UsePresenceOptions = {}
): UsePresenceResult {
  const { onExitComplete, timeoutCap = DEFAULT_TIMEOUT_CAP_MS } = options;

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

  // Drive the exit once we enter 'closing'.
  //
  // The animated element is often a CHILD of the ref'd node, and its data-state
  // flips a render-tick after this effect runs (it is consumer/context-driven),
  // so an empty getAnimations() on the first read does NOT mean "no exit". We
  // read once after a forced reflow (covers the native-dialog case, where the
  // animated element IS the ref'd element); if nothing is running we keep
  // transitionrun/animationstart listeners attached and collect each animation
  // as it starts (they bubble up from the child), so staggered or
  // different-duration exits are all awaited. We finalize when every tracked
  // animation has settled, fall back to finalizing if none ever starts, and cap
  // the total wait as a stuck-animation safety net.
  //
  // Locals: track() collects newly-started exit animations; onSettled finalizes
  // once all tracked ones end; finalize is the single-fire, generation-guarded
  // teardown and is also the effect's cleanup, so reopen/unmount aborts cleanly.
  useLayoutEffect(() => {
    if (status !== 'closing') return;
    const node = nodeRef.current;
    const myGen = genRef.current;

    // Commit the close, unless a reopen advanced the generation in the meantime.
    const commit = () => {
      if (genRef.current !== myGen) return;
      onExitCompleteRef.current?.();
      setStatus('closed');
    };

    if (
      !node ||
      typeof node.getAnimations !== 'function' ||
      prefersReducedMotion()
    ) {
      commit();
      return;
    }

    let finalized = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const tracked = new Set<Animation>();
    let pending = 0;

    const stop = () => {
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
      if (capTimer !== undefined) clearTimeout(capTimer);
      node.removeEventListener('transitionrun', onStart);
      node.removeEventListener('animationstart', onStart);
    };

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      stop();
      commit();
    };

    const onSettled = () => {
      pending--;
      if (pending === 0) finalize();
    };

    const track = () => {
      const active = node
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      for (const a of active) {
        if (tracked.has(a)) continue;
        tracked.add(a);
        pending++;
        a.finished.then(onSettled, onSettled);
      }
      if (tracked.size > 0) {
        // An exit animation is running: drop the no-animation fallback and
        // (re)arm the safety cap to cover the longest tracked animation.
        if (fallbackTimer !== undefined) {
          clearTimeout(fallbackTimer);
          fallbackTimer = undefined;
        }
        if (capTimer !== undefined) clearTimeout(capTimer);
        capTimer = setTimeout(
          finalize,
          exitTimeout([...tracked], timeoutCapRef.current)
        );
      }
    };

    function onStart() {
      track();
    }

    // Forced reflow so just-applied closed-state styles register, then read.
    // getBoundingClientRect (Element) avoids a cast; never rAF (paused in
    // background tabs, which would hang the close).
    node.getBoundingClientRect();
    track();
    if (pending === 0) {
      node.addEventListener('transitionrun', onStart);
      node.addEventListener('animationstart', onStart);
      fallbackTimer = setTimeout(finalize, NO_ANIMATION_FALLBACK_MS);
    }

    return finalize;
  }, [status]);

  // isPresent stays true until status is 'closed' (not merely while 'closing'):
  // the 'closing' status is set in the layout effect above, which runs AFTER the
  // close render commits, so on that first present===false render status is
  // still 'open'. Keying off 'closing' would drop isPresent false for that one
  // committed render, unmounting / display:none-ing the element and cancelling
  // its exit before it starts. Staying present until 'closed' keeps the element
  // rendered continuously so the exit animation plays.
  return {
    isPresent: present || status !== 'closed',
    status,
    ref,
  };
}
