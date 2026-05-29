import { useEffect, useRef } from 'preact/hooks';
import { __subscribePhase } from './internal/route-change.js';
import type { ViewTransitionEvent } from './internal/view-transition-event.js';

export type ViewTransitionPhaseCallback = (
  event: ViewTransitionEvent
) => void | Promise<void>;

export interface ViewTransitionLifecycle {
  onBeforeTransition?: ViewTransitionPhaseCallback;
  onBeforeSwap?: ViewTransitionPhaseCallback;
  onAfterSwap?: ViewTransitionPhaseCallback;
  onAfterTransition?: ViewTransitionPhaseCallback;
}

export function useViewTransitionLifecycle(
  lifecycle: ViewTransitionLifecycle
): void {
  const ref = useRef(lifecycle);
  ref.current = lifecycle;

  useEffect(() => {
    const unsubs = [
      __subscribePhase('beforeTransition', (e) =>
        ref.current.onBeforeTransition?.(e)
      ),
      __subscribePhase('beforeSwap', (e) => ref.current.onBeforeSwap?.(e)),
      __subscribePhase('afterSwap', (e) => ref.current.onAfterSwap?.(e)),
      __subscribePhase('afterTransition', (e) =>
        ref.current.onAfterTransition?.(e)
      ),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
}
