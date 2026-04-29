import { useRef } from 'preact/hooks';
import { type RouteHook } from 'preact-iso';
import { type GuardFn, type GuardResult, runGuards } from './guard.js';
import wrapPromise from './wrap-promise.js';

export type GuardSuspender = { read: () => GuardResult };

/**
 * Returns a stable suspender that survives across re-renders. Does NOT throw.
 * Must be called in a component that does NOT live inside the Suspense
 * boundary that catches the suspender's read — otherwise useRef is reset on
 * each suspend (Preact's compat Suspense remounts children of the boundary).
 */
export function useGuardSuspender(
  guards: GuardFn[],
  location: RouteHook
): GuardSuspender {
  const prevPath = useRef<string | null>(null);
  const ref = useRef<GuardSuspender | null>(null);

  if (ref.current === null || prevPath.current !== location.path) {
    prevPath.current = location.path;
    ref.current = wrapPromise(runGuards(guards, { location }));
  }
  return ref.current;
}

/**
 * Convenience hook combining {@link useGuardSuspender} with read.
 * The caller must place the catching `<Suspense>` ABOVE this component.
 * For Page-style nesting (Suspense inside the orchestrator), use
 * {@link useGuardSuspender} and call `.read()` in a child component.
 */
export function useGuards(
  guards: GuardFn[],
  location: RouteHook
): GuardResult | null {
  const susp = useGuardSuspender(guards, location);
  return susp.read() ?? null;
}
