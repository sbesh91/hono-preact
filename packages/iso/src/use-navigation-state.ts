import { getNavPending, subscribeNavState } from './internal/route-change.js';

export interface NavigationState {
  /** True while a client navigation is in flight (a Router is mid-suspense). */
  pending: boolean;
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
