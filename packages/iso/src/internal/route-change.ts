import { flushSync } from 'preact/compat';
import {
  ViewTransitionEvent,
  type NavDirection,
} from './view-transition-event.js';
import { getNavDirection } from './history-shim.js';

export type PhaseName =
  | 'beforeTransition'
  | 'beforeSwap'
  | 'afterSwap'
  | 'afterTransition';

type PhaseSub = (event: ViewTransitionEvent) => void | Promise<void>;
type LegacySub = (to: string, from: string | undefined) => void;

const phaseSubs: Record<PhaseName, Set<PhaseSub>> = {
  beforeTransition: new Set(),
  beforeSwap: new Set(),
  afterSwap: new Set(),
  afterTransition: new Set(),
};

const legacySubs = new Set<LegacySub>();

export function __subscribePhase(phase: PhaseName, sub: PhaseSub): () => void {
  phaseSubs[phase].add(sub);
  return () => {
    phaseSubs[phase].delete(sub);
  };
}

export function __subscribeRouteChange(sub: LegacySub): () => void {
  legacySubs.add(sub);
  return () => {
    legacySubs.delete(sub);
  };
}

function fireLegacy(to: string, from: string | undefined): void {
  for (const sub of legacySubs) sub(to, from);
}

function getStartViewTransition():
  | ((cb: () => void) => ViewTransition)
  | undefined {
  if (typeof document === 'undefined') return undefined;
  const fn = (
    document as { startViewTransition?: (cb: () => void) => ViewTransition }
  ).startViewTransition;
  return typeof fn === 'function' ? fn.bind(document) : undefined;
}

// Coordinator state. `loadingDepth` is how many Routers are mid-suspense (via
// their onLoadStart/onLoadEnd). `pending` is a cold navigation whose
// beforeTransition has fired but whose transition is deferred until the route's
// content commits (see __wrapRouteCommit).
let loadingDepth = 0;
let pending: ViewTransitionEvent | null = null;

export function __noteLoadStart(): void {
  loadingDepth++;
}
export function __noteLoadEnd(): void {
  loadingDepth = Math.max(0, loadingDepth - 1);
}

/** @internal Test-only reset for coordinator state. */
export function __resetTransitionStateForTesting(): void {
  loadingDepth = 0;
  pending = null;
}

function fireAfterSwap(event: ViewTransitionEvent): void {
  for (const sub of phaseSubs.afterSwap) sub(event);
  // Legacy subscribers fire at the afterSwap slot: after the DOM swap, before
  // the browser begins animating the new frame.
  fireLegacy(event.to, event.from);
}

function fireAfterTransition(
  event: ViewTransitionEvent,
  reason?: 'skipped' | 'unsupported' | 'aborted'
): void {
  if (reason !== undefined) event.reason = reason;
  for (const sub of phaseSubs.afterTransition) sub(event);
}

// Runs `swap` wrapped in a view transition (when available), firing the
// post-swap phases and applying the event's accumulated types. Used by both the
// warm path (swap = no-op; flushSync flushes the already-pending route render)
// and the cold path (swap = the deferred content commit).
function runTransition(event: ViewTransitionEvent, swap: () => void): void {
  if (event._skipped) {
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'skipped');
    return;
  }
  const start = getStartViewTransition();
  if (!start) {
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'unsupported');
    return;
  }
  let transition: ViewTransition;
  try {
    transition = start(() => {
      flushSync(swap);
    });
  } catch {
    // Non-conformant / polyfilled startViewTransition that throws synchronously:
    // still perform the swap so the navigation completes.
    flushSync(swap);
    fireAfterSwap(event);
    fireAfterTransition(event, 'unsupported');
    return;
  }
  event.transition = transition;
  for (const sub of phaseSubs.beforeSwap) sub(event);
  fireAfterSwap(event);
  const vtTypes = (
    transition as ViewTransition & { types?: { add(t: string): void } }
  ).types;
  if (vtTypes && typeof vtTypes.add === 'function') {
    for (const t of event.types) vtTypes.add(t);
  }
  transition.finished.then(
    () => fireAfterTransition(event),
    () => fireAfterTransition(event, 'aborted')
  );
}

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  ensureDefaultTypes();
  const direction: NavDirection = getNavDirection();
  const event = new ViewTransitionEvent({ to, from, direction });

  for (const sub of phaseSubs.beforeTransition) sub(event);

  if (loadingDepth > 0) {
    // Cold navigation: the route is still loading, so its real content swap
    // happens later via __wrapRouteCommit. Defer the transition to that commit.
    // (A still-unconsumed pending from a prior nav is discarded here.)
    pending = event;
    return;
  }

  // Warm navigation: the route render is already pending; flushSync inside the
  // transition commits it.
  runTransition(event, () => {});
}

// Called from each Router's `wrapUpdate` (preact-iso fork). Runs the deferred
// transition for the current cold navigation, or commits directly when there is
// none (a later nested commit, the initial route load, or a post-load
// re-suspense).
export function __wrapRouteCommit(commit: () => void): void {
  if (pending) {
    const event = pending;
    pending = null;
    runTransition(event, commit);
  } else {
    commit();
  }
}

let defaultTypesInstalled = false;
let firstDispatchSeen = false;
let defaultTypeUnsubscriber: (() => void) | null = null;

function ensureDefaultTypes(): void {
  if (defaultTypesInstalled) return;
  defaultTypesInstalled = true;
  defaultTypeUnsubscriber = __subscribePhase('beforeTransition', (event) => {
    if (!firstDispatchSeen) {
      event.types.push('nav-initial');
      firstDispatchSeen = true;
    } else {
      event.types.push(`nav-${event.direction}`);
    }
    event.types.push('nav-same-origin');
  });
}

/** @internal Test-only reset for default-types installer. */
export function resetDefaultTypesForTesting(): void {
  if (defaultTypeUnsubscriber) {
    defaultTypeUnsubscriber();
  }
  defaultTypesInstalled = false;
  firstDispatchSeen = false;
  defaultTypeUnsubscriber = null;
}
