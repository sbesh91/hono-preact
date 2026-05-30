import type { NavDirection } from './view-transition-event.js';

interface ShimState {
  __hpVtIdx?: number;
}

let installed = false;
let counter = 0;
let lastDirection: NavDirection = 'initial';
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
  };

  popstateListener = (e: PopStateEvent) => {
    const incoming = (e.state as ShimState | null)?.__hpVtIdx ?? 0;
    lastDirection =
      incoming < counter ? 'back' : incoming > counter ? 'forward' : 'replace';
    counter = incoming;
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
 * still showing its server-rendered, freshly hydrated route. That is the only
 * situation where a client-middleware redirect must hard-navigate: an
 * effect-driven SPA route() during hydration leaves preact-iso's Router
 * holding the server-committed DOM alongside the redirect target, mounting
 * both. `lastDirection` only ever moves away from 'initial' (never back),
 * so this is a monotonic "have we navigated yet" flag.
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
}

/** Test-only direction setter. Do not call from production code. */
export function setNavDirectionForTesting(dir: NavDirection): void {
  lastDirection = dir;
}
