import { useEffect, useRef } from 'preact/hooks';
import { __subscribePhase } from './internal/route-change.js';
import type { NavDirection } from './internal/view-transition-event.js';

export interface ViewTransitionTypesNav {
  to: string;
  from: string | undefined;
  direction: NavDirection;
}

export type ViewTransitionTypesInput =
  | string
  | string[]
  | ((nav: ViewTransitionTypesNav) => string | string[] | null | undefined);

export function useViewTransitionTypes(input: ViewTransitionTypesInput): void {
  const ref = useRef(input);
  ref.current = input;

  useEffect(() => {
    return __subscribePhase('beforeTransition', (event) => {
      const v = ref.current;
      const resolved =
        typeof v === 'function'
          ? v({ to: event.to, from: event.from, direction: event.direction })
          : v;
      if (resolved == null) return;
      if (typeof resolved === 'string') event.types.push(resolved);
      else for (const t of resolved) event.types.push(t);
    });
  }, []);
}
