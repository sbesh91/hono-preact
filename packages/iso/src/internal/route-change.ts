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
  | ((cb: () => void | Promise<void>) => ViewTransition)
  | undefined {
  if (typeof document === 'undefined') return undefined;
  const fn = (
    document as {
      startViewTransition?: (cb: () => void | Promise<void>) => ViewTransition;
    }
  ).startViewTransition;
  return typeof fn === 'function' ? fn.bind(document) : undefined;
}

function currentPath(): string {
  return typeof location !== 'undefined'
    ? location.pathname + location.search
    : '';
}

// `loadingDepth`: how many Routers are mid-suspense (via onLoadStart/onLoadEnd).
// Read right after a navigation commits to tell whether the route suspended (a
// cold navigation), so the transition can wait for the suspended content.
let loadingDepth = 0;
export function __noteLoadStart(): void {
  loadingDepth++;
}
export function __noteLoadEnd(): void {
  loadingDepth = Math.max(0, loadingDepth - 1);
}

// The path the app is currently on (the previous navigation's `to`); seeds
// `from` for the first navigation. A server render leaves it undefined.
let lastPath: string | undefined =
  typeof location !== 'undefined'
    ? location.pathname + location.search
    : undefined;

// Cold-navigation bridge. A suspending route's content commits later via
// __wrapRouteCommit; the in-flight transition awaits it so the new snapshot is
// the loaded content (or shell), not the suspense fallback.
let coldResolve: (() => void) | null = null;
let coldTimeout: ReturnType<typeof setTimeout> | null = null;
// Bumped per navigation so a superseded transition's (async) callback bows out.
let navGen = 0;
// Cap on how long a navigation holds the old snapshot waiting for a suspending
// route's content. Past it the navigation completes without finishing the
// transition rather than freezing the page on a slow/stalled load.
const COLD_COMMIT_TIMEOUT_MS = 500;

/** @internal Test-only reset for coordinator state. */
export function __resetTransitionStateForTesting(): void {
  loadingDepth = 0;
  navGen = 0;
  lastPath =
    typeof location !== 'undefined'
      ? location.pathname + location.search
      : undefined;
  if (coldTimeout !== null) {
    clearTimeout(coldTimeout);
    coldTimeout = null;
  }
  coldResolve = null;
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

function applyTypes(
  transition: ViewTransition,
  types: readonly string[]
): void {
  const vtTypes = (
    transition as ViewTransition & { types?: { add(t: string): void } }
  ).types;
  if (vtTypes && typeof vtTypes.add === 'function') {
    for (const t of types) vtTypes.add(t);
  }
}

function skipTransition(transition: ViewTransition): void {
  const t = transition as ViewTransition & { skipTransition?: () => void };
  if (typeof t.skipTransition === 'function') t.skipTransition();
}

// Build the event for a navigation that has just committed: `to`/`direction`
// are only correct after the commit (pushState updates the history shim), so
// this is always called post-commit. Advances `lastPath`.
function buildEvent(from: string | undefined): ViewTransitionEvent {
  ensureDefaultTypes();
  const to = currentPath();
  lastPath = to;
  const direction: NavDirection = getNavDirection();
  const event = new ViewTransitionEvent({ to, from, direction });
  for (const sub of phaseSubs.beforeTransition) sub(event);
  return event;
}

// Resolve the pending cold bridge — the content commit arrived, the timeout
// fired, or a newer navigation superseded it.
function resolveCold(): void {
  if (coldTimeout !== null) {
    clearTimeout(coldTimeout);
    coldTimeout = null;
  }
  const resolve = coldResolve;
  coldResolve = null;
  if (resolve) resolve();
}

// Called from `LocationProvider`'s `wrapNavigation` (preact-iso fork). Starts
// the view transition, THEN performs the navigation inside it (flushSync) so the
// browser captures the current route as the old snapshot before the new route
// swaps in. For a navigation to a suspending route, the transition waits for the
// content to commit (via __wrapRouteCommit) before finishing.
export function __wrapNavigation(commit: () => void): void {
  const from = lastPath;

  // A previous cold navigation never finished committing; abandon it so its
  // transition can't stay frozen and its callback won't touch live state.
  if (coldResolve) {
    navGen++;
    resolveCold();
  }

  const start = getStartViewTransition();
  if (!start) {
    // No view transitions: navigate, then fire the post-swap phases (no
    // transition runs, so `beforeSwap` is skipped).
    flushSync(commit);
    const event = buildEvent(from);
    fireAfterSwap(event);
    fireAfterTransition(event, event._skipped ? 'skipped' : 'unsupported');
    return;
  }

  const myGen = ++navGen;
  let transition: ViewTransition;
  let event: ViewTransitionEvent | undefined;
  try {
    transition = start(async () => {
      // The old snapshot has been captured. Perform the navigation.
      flushSync(commit);
      if (navGen !== myGen) return; // superseded while capturing
      event = buildEvent(from);
      event.transition = transition;
      applyTypes(transition, event.types);

      if (event._skipped) {
        skipTransition(transition);
      } else {
        for (const sub of phaseSubs.beforeSwap) sub(event);
        if (loadingDepth > 0) {
          // Cold navigation: the new route suspended. Wait for its content (the
          // shell) to commit via __wrapRouteCommit, so the new snapshot is the
          // loaded route rather than the suspense fallback.
          await new Promise<void>((resolve) => {
            coldResolve = resolve;
            coldTimeout = setTimeout(() => {
              if (navGen === myGen) resolveCold();
            }, COLD_COMMIT_TIMEOUT_MS);
          });
        }
      }

      if (navGen !== myGen) return;
      fireAfterSwap(event);
    });
  } catch {
    // Non-conformant / polyfilled startViewTransition that throws synchronously:
    // still perform the navigation and fire the post-swap phases.
    flushSync(commit);
    const ev = buildEvent(from);
    fireAfterSwap(ev);
    fireAfterTransition(ev, 'unsupported');
    return;
  }

  transition.finished.then(
    () => {
      if (event)
        fireAfterTransition(event, event._skipped ? 'skipped' : undefined);
    },
    () => {
      if (event) fireAfterTransition(event, 'aborted');
    }
  );
}

// Synchronous route-change dispatch for an explicit `to`/`from`: fires
// `beforeTransition` and runs a transition that wraps a no-op swap (the route is
// assumed already on screen), firing the post-swap phases and applying types.
// Production navigations go through `__wrapNavigation`; this drives the same
// phase/type/lifecycle machinery directly for callers that change the route
// outside the normal navigation flow (and in unit tests).
export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  ensureDefaultTypes();
  const event = new ViewTransitionEvent({
    to,
    from,
    direction: getNavDirection(),
  });
  for (const sub of phaseSubs.beforeTransition) sub(event);

  const start = getStartViewTransition();
  if (!start || event._skipped) {
    // No transition runs, so `beforeSwap` (which precedes a real swap) is
    // skipped; the post-swap phases still fire.
    fireAfterSwap(event);
    fireAfterTransition(event, event._skipped ? 'skipped' : 'unsupported');
    return;
  }
  let transition: ViewTransition;
  try {
    transition = start(() => {});
  } catch {
    fireAfterSwap(event);
    fireAfterTransition(event, 'unsupported');
    return;
  }
  event.transition = transition;
  applyTypes(transition, event.types);
  for (const sub of phaseSubs.beforeSwap) sub(event);
  fireAfterSwap(event);
  transition.finished.then(
    () => fireAfterTransition(event),
    () => fireAfterTransition(event, 'aborted')
  );
}

// Called from each Router's `wrapUpdate` (preact-iso fork). When a cold
// navigation is awaiting its content, apply the commit and resume the
// transition; otherwise commit directly (the initial route load, a nested
// fill-in commit after the shell, or a post-load re-suspense).
export function __wrapRouteCommit(commit: () => void): void {
  if (coldResolve) {
    flushSync(commit);
    resolveCold();
  } else {
    commit();
  }
}

let defaultTypesInstalled = false;
let firstNavSeen = false;
let defaultTypeUnsubscriber: (() => void) | null = null;

function ensureDefaultTypes(): void {
  if (defaultTypesInstalled) return;
  defaultTypesInstalled = true;
  defaultTypeUnsubscriber = __subscribePhase('beforeTransition', (event) => {
    if (!firstNavSeen) {
      event.types.push('nav-initial');
      firstNavSeen = true;
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
  firstNavSeen = false;
  defaultTypeUnsubscriber = null;
}
