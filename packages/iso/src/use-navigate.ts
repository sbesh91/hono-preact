import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { skipNextNavTransition } from './internal/route-change.js';

// A soft navigation to the url we are already on produces no navigated flush, so
// arming the one-shot transition skip would strand it onto the next real
// navigation. Only arm when the resolved target actually differs from the
// current url. Unparseable input falls through to arming (the prior behavior).
function resolvesToCurrentUrl(path: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(path, location.href).href === location.href;
  } catch {
    return false;
  }
}

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Do a full-page navigation (clean slate) instead of a client navigation. */
  reload?: boolean;
  /**
   * Set false to update the URL without a view transition (the render still
   * commits). Default: animate. Ignored when `reload` is true (a full-page load
   * has no transition to suppress).
   */
  transition?: boolean;
}

/**
 * Imperative client navigation for use in event handlers. A soft navigate (the
 * default) goes through preact-iso's `route`, the same entry point a link click
 * reaches, so the framework's client middleware, loaders, and view transitions
 * all run. `reload` does a hard navigation; `replace` avoids a new history entry.
 * Call within the app's LocationProvider tree (every page is).
 */
export function useNavigate(): (
  path: string,
  options?: NavigateOptions
) => void {
  const { route } = useLocation();
  return useCallback(
    (path: string, options?: NavigateOptions) => {
      if (options?.reload) {
        if (typeof window !== 'undefined') window.location.assign(path);
        return;
      }
      if (options?.transition === false && !resolvesToCurrentUrl(path))
        skipNextNavTransition();
      route(path, options?.replace ?? false);
    },
    [route]
  );
}
