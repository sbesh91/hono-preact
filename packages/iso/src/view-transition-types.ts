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

/**
 * Register a global, route-aware view-transition type rule. The resolver runs on
 * every navigation with `{ to, from, direction }` and returns the type(s) to add
 * to that navigation's transition (a static string/array adds the same type(s) to
 * every navigation). Returns an unsubscribe.
 *
 * Unlike {@link useViewTransitionTypes}, this is not tied to a mounted component,
 * so it covers entering AND leaving a section (a layout hook is not subscribed yet
 * on enter and is already torn down on leave). No-op on the server (no document).
 */
export function subscribeViewTransitionTypes(
  input: ViewTransitionTypesInput
): () => void {
  if (typeof document === 'undefined') return () => {};
  return __subscribePhase('beforeTransition', (event) => {
    const resolved =
      typeof input === 'function'
        ? input({ to: event.to, from: event.from, direction: event.direction })
        : input;
    if (resolved == null) return;
    if (typeof resolved === 'string') event.types.push(resolved);
    else for (const t of resolved) event.types.push(t);
  });
}

export function useViewTransitionTypes(input: ViewTransitionTypesInput): void {
  const ref = useRef(input);
  ref.current = input;

  useEffect(
    () =>
      subscribeViewTransitionTypes((nav) => {
        const v = ref.current;
        return typeof v === 'function' ? v(nav) : v;
      }),
    []
  );
}
