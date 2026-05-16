import { flushSync } from 'preact/compat';

type Sub = (to: string, from: string | undefined) => void;

const subs = new Set<Sub>();
let viewTransitionEnabled = 0;
let vtClickCleanup: (() => void) | null = null;

export function __dispatchRouteChange(to: string, from: string | undefined): void {
  for (const cb of subs) cb(to, from);
}

export function __subscribeRouteChange(sub: Sub): () => void {
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

type StartViewTransition = (cb: () => void | Promise<void>) => unknown;

/**
 * Replicates preact-iso's click filtering. Returns the resolved href when the
 * click is a same-origin SPA navigation we should intercept, otherwise null.
 */
function matchSpaLinkClick(e: MouseEvent): string | null {
  if (e.defaultPrevented) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) {
    return null;
  }
  const path = e.composedPath();
  let link: HTMLAnchorElement | null = null;
  for (const el of path) {
    if (el instanceof HTMLAnchorElement && el.href) {
      link = el;
      break;
    }
  }
  if (!link) return null;
  if (link.origin !== location.origin) return null;
  const href = link.getAttribute('href');
  if (!href || /^#/.test(href)) return null;
  if (link.target && !/^_?self$/i.test(link.target)) return null;
  if (link.hasAttribute('download')) return null;
  return link.href;
}

export function __enableViewTransitions(): () => void {
  viewTransitionEnabled++;
  if (viewTransitionEnabled === 1 && typeof document !== 'undefined') {
    const startViewTransition = (document as { startViewTransition?: StartViewTransition })
      .startViewTransition;
    if (typeof startViewTransition === 'function') {
      // Capture-phase listener fires before preact-iso's bubble-phase click
      // handler. We wrap the navigation in startViewTransition so the API
      // captures the pre-nav DOM as the "old" snapshot, then commits the new
      // URL inside the callback for the "new" snapshot. preact-iso is fed a
      // synthetic popstate after pushState, which it already handles.
      const onClick = (e: MouseEvent): void => {
        if (viewTransitionEnabled <= 0) return;
        const targetHref = matchSpaLinkClick(e);
        if (!targetHref) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        startViewTransition.call(document, () => {
          history.pushState(null, '', targetHref);
          dispatchEvent(new PopStateEvent('popstate'));
          // Force preact-iso's url state update to commit synchronously so
          // the new DOM is in place when startViewTransition snapshots it.
          flushSync(() => {});
        });
      };
      document.addEventListener('click', onClick, true);
      vtClickCleanup = () => document.removeEventListener('click', onClick, true);
    }
  }
  return () => {
    viewTransitionEnabled--;
    if (viewTransitionEnabled === 0 && vtClickCleanup) {
      vtClickCleanup();
      vtClickCleanup = null;
    }
  };
}
