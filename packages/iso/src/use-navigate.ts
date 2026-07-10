import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { skipNextNavTransition } from './internal/route-change.js';

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Do a full-page navigation (clean slate) instead of a client navigation. */
  reload?: boolean;
  /**
   * Set false to update the URL without a view transition (the render still
   * commits). Default: animate. Ignored when `reload` is true (a full-page
   * load has no transition to suppress) and for same-document fragment
   * targets (hash-only URL changes never animate).
   */
  transition?: boolean;
}

/**
 * Imperative client navigation for use in event handlers. A soft navigate (the
 * default) goes through preact-iso's `route`, the same entry point a link click
 * reaches, so the framework's client middleware, loaders, and view transitions
 * all run. A same-document fragment target (`navigate('#usage')`) writes the
 * hash to the URL and scrolls to the matching element like a native anchor
 * click; no route change happens. `reload` does a hard navigation; `replace`
 * avoids a new history entry. Call within the app's LocationProvider tree
 * (every page is).
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
      // Same-document fragment target. preact-iso's route() would store '#id'
      // as the URL state and resolve it against the origin, rendering the home
      // page; own the history write here (through the history shim's patched
      // pushState, keeping the direction counter coherent) and scroll like the
      // native anchor default. Hash-only URL changes are not navigations, so
      // there is no view transition to suppress.
      if (path[0] === '#') {
        if (typeof window === 'undefined') return;
        if (options?.replace) history.replaceState(null, '', path);
        else history.pushState(null, '', path);
        document
          .getElementById(path.slice(1))
          ?.scrollIntoView({ block: 'start' });
        return;
      }
      // Keyed to the target: if the navigation produces no navigated flush
      // (e.g. a same-URL push), the arm expires at the next navigation to any
      // other URL instead of suppressing it.
      if (options?.transition === false) skipNextNavTransition(path);
      route(path, options?.replace ?? false);
    },
    [route]
  );
}
