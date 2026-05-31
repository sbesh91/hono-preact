import type { NavDirection } from './view-transition-event.js';

interface ShimState {
  __hpVtIdx?: number;
}

let installed = false;
let counter = 0;
let lastDirection: NavDirection = 'initial';

// Fires synchronously whenever a navigation occurs (pushState / replaceState /
// popstate), BEFORE the resulting re-render. Lets the view-transition scheduler
// observe a navigation at navigation time rather than only at render time (which
// Preact's render batching can coalesce away). See route-change.ts.
const navListeners = new Set<() => void>();
export function onNavigation(listener: () => void): () => void {
  navListeners.add(listener);
  return () => navListeners.delete(listener);
}
function notifyNavigation(): void {
  for (const listener of navListeners) listener();
}
let originalPush:
  | ((state: unknown, title: string, url?: string | URL | null) => void)
  | null = null;
let originalReplace:
  | ((state: unknown, title: string, url?: string | URL | null) => void)
  | null = null;
let popstateListener: ((e: PopStateEvent) => void) | null = null;

function readCounterFromState(): number {
  if (typeof history === 'undefined') return 0;
  const state = history.state as ShimState | null;
  return state?.__hpVtIdx ?? 0;
}

export function installHistoryShim(): void {
  if (installed) return;
  if (typeof history === 'undefined' || typeof window === 'undefined') return;

  installed = true;
  counter = readCounterFromState();
  lastDirection = 'initial';

  originalPush = history.pushState.bind(history);
  originalReplace = history.replaceState.bind(history);

  history.pushState = function patchedPush(
    state: unknown,
    title: string,
    url?: string | URL | null
  ): void {
    counter += 1;
    const merged: ShimState = {
      ...((state as ShimState | null) ?? {}),
      __hpVtIdx: counter,
    };
    originalPush!(merged, title, url);
    lastDirection = 'push';
    notifyNavigation();
  };

  history.replaceState = function patchedReplace(
    state: unknown,
    title: string,
    url?: string | URL | null
  ): void {
    const merged: ShimState = {
      ...((state as ShimState | null) ?? {}),
      __hpVtIdx: counter,
    };
    originalReplace!(merged, title, url);
    lastDirection = 'replace';
    notifyNavigation();
  };

  popstateListener = (e: PopStateEvent) => {
    const incoming = (e.state as ShimState | null)?.__hpVtIdx ?? 0;
    lastDirection =
      incoming < counter ? 'back' : incoming > counter ? 'forward' : 'replace';
    counter = incoming;
    notifyNavigation();
  };
  window.addEventListener('popstate', popstateListener, { capture: true });

  // Stamp the current entry so subsequent diffs are well-defined.
  if ((history.state as ShimState | null)?.__hpVtIdx === undefined) {
    originalReplace(
      { ...((history.state as object | null) ?? {}), __hpVtIdx: counter },
      ''
    );
  }
}

export function getNavDirection(): NavDirection {
  return lastDirection;
}

/**
 * True once any client-side navigation (push, replace, or popstate) has
 * occurred since the page loaded. Before the first navigation the document is
 * still showing its server-rendered, freshly hydrated route. PageMiddlewareHost
 * uses this to pick its render strategy: on the initial load it renders the
 * server children during hydration and applies the client middleware outcome
 * afterwards (so a Suspense boundary never resolves to non-SSR content
 * mid-hydration, which would orphan the server route DOM); after a navigation
 * it suspends on the chain normally. `lastDirection` only ever moves away from
 * 'initial' (never back), so this is a monotonic "have we navigated yet" flag.
 */
export function hasClientNavigated(): boolean {
  return lastDirection !== 'initial';
}

/** Test-only reset. Do not call from production code. */
export function resetHistoryShimForTesting(): void {
  if (
    installed &&
    typeof history !== 'undefined' &&
    originalPush &&
    originalReplace
  ) {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
  }
  if (typeof window !== 'undefined' && popstateListener) {
    window.removeEventListener('popstate', popstateListener, {
      capture: true,
    });
  }
  installed = false;
  counter = 0;
  lastDirection = 'initial';
  originalPush = null;
  originalReplace = null;
  popstateListener = null;
  navListeners.clear();
}

/** Test-only direction setter. Do not call from production code. */
export function setNavDirectionForTesting(dir: NavDirection): void {
  lastDirection = dir;
}
