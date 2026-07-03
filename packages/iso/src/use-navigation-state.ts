import { useEffect, useState } from 'preact/hooks';
import { getNavPending, subscribeNavState } from './internal/route-change.js';
import { useStoreSnapshot } from './internal/use-store-snapshot.js';

export interface NavigationState {
  /** True while a client navigation is in flight (a Router is mid-suspense). */
  pending: boolean;
}

export interface UseNavigationStateOptions {
  /**
   * Report `pending: true` only after the navigation has stayed pending for
   * `delayMs` (flash prevention for fast, cache-hit navigations). Flips back to
   * false immediately when the navigation ends. Default 0 (report immediately).
   */
  delayMs?: number;
}

/**
 * Subscribe to navigation-pending changes without React. Calls `listener` once
 * immediately with the current state, then on every change. Returns an
 * unsubscribe function.
 */
export function subscribeNavigationState(
  listener: (state: NavigationState) => void
): () => void {
  listener({ pending: getNavPending() });
  return subscribeNavState(() => listener({ pending: getNavPending() }));
}

/**
 * Reactive navigation-pending state. `pending` is true while a client navigation
 * is in flight. On the server and initial hydration it is false (no Router is
 * suspended). Pass `delayMs` to report `pending: true` only after the navigation
 * has stayed pending that long (flash prevention for fast, cache-hit
 * navigations); it drops to false immediately when the navigation ends.
 */
export function useNavigationState(
  options?: UseNavigationStateOptions
): NavigationState {
  const raw = useStoreSnapshot(subscribeNavState, getNavPending);
  const delayMs = options?.delayMs ?? 0;
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (delayMs <= 0) return; // `raw` is returned directly; `delayed` is unused
    if (!raw) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [raw, delayMs]);
  const pending = delayMs <= 0 ? raw : raw && delayed;
  return { pending };
}
