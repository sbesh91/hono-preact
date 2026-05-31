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
// their onLoadStart/onLoadEnd). `pending` holds a cold navigation only on the
// no-view-transitions fallback path; the normal cold path starts the transition
// at dispatch and bridges its swap to the route's content commit.
let loadingDepth = 0;
let pending: ViewTransitionEvent | null = null;

// Cold-morph bridge state (Approach: capture the old snapshot at dispatch, while
// the source route is still mounted, then swap when the content commits).
//
// `coldActive` is true between starting a cold transition and its swap; while it
// is true, newly-mounted ViewTransitionName elements defer naming themselves so
// the destination isn't named in the old snapshot. `deferredNames` collects
// those name-applications; they run in the swap so they land in the new
// snapshot. `coldBridgeResolve` resumes the (async) transition callback once the
// route's content is ready; `coldCommit` is that content commit.
let coldActive = false;
let deferredNames: Array<() => void> = [];
let coldBridgeResolve: (() => void) | null = null;
let coldCommit: (() => void) | null = null;
let coldTimeout: ReturnType<typeof setTimeout> | null = null;
// Bumped per cold transition so a superseded one's (async) callback, once
// resumed, can detect it is no longer current and bow out without clobbering
// the live transition's state.
let coldGen = 0;

// Safety net: the longest a cold navigation will hold the page frozen waiting
// for its content commit. A commit normally arrives within a frame or two (the
// lazy route module resolving); this only fires if the load stalls or errors,
// so the page can't stay frozen indefinitely.
const COLD_COMMIT_TIMEOUT_MS = 2000;

export function __isColdTransitionActive(): boolean {
  return coldActive;
}
export function __deferTransitionName(apply: () => void): void {
  deferredNames.push(apply);
}
function flushDeferredNames(): void {
  const queued = deferredNames;
  deferredNames = [];
  for (const apply of queued) apply();
}

// Resume a cold transition that is awaiting its content commit (or its timeout).
// Used by __wrapRouteCommit (the commit arrived), by a subsequent navigation
// (the previous cold nav was abandoned mid-flight), and by the timeout. If no
// commit is set the transition swaps nothing; the deferred names are flushed
// either way so incoming elements end up named.
function resumeColdTransition(): void {
  if (coldTimeout !== null) {
    clearTimeout(coldTimeout);
    coldTimeout = null;
  }
  const resolve = coldBridgeResolve;
  coldBridgeResolve = null;
  if (resolve) resolve();
}

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
  coldActive = false;
  deferredNames = [];
  coldBridgeResolve = null;
  coldCommit = null;
  if (coldTimeout !== null) {
    clearTimeout(coldTimeout);
    coldTimeout = null;
  }
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

  // If a previous cold navigation is still awaiting its content commit, this new
  // navigation abandoned it — resume it now (swapping nothing) so its transition
  // can't stay frozen.
  if (coldBridgeResolve) resumeColdTransition();

  for (const sub of phaseSubs.beforeTransition) sub(event);

  if (loadingDepth > 0) {
    // Cold navigation: start the transition NOW so the browser captures the
    // still-mounted source route as the old snapshot, and bridge the swap to
    // the route's content commit (see __wrapRouteCommit).
    runColdTransition(event);
    return;
  }

  // Warm navigation: the route render is already pending; flushSync inside the
  // transition commits it.
  runTransition(event, () => {});
}

// Cold path: start the transition at dispatch (old snapshot = the source route,
// still mounted), then resume and swap when the content commits.
function runColdTransition(event: ViewTransitionEvent): void {
  const start = getStartViewTransition();
  if (!start || event._skipped) {
    // No view transitions (or skipped): fall back to the deferred,
    // non-morphing path — the swap still happens at the content commit.
    pending = event;
    return;
  }
  const myGen = ++coldGen;
  coldActive = true;
  let transition: ViewTransition;
  try {
    transition = start(async () => {
      // The old snapshot has been captured. Wait for the route content to
      // commit, then swap and reveal the deferred incoming names so they land
      // in the new snapshot.
      await new Promise<void>((resolve) => {
        coldBridgeResolve = resolve;
      });
      // A newer navigation superseded this one while it was waiting: let this
      // (now-stale) transition complete as a no-op rather than touch live state.
      if (coldGen !== myGen) return;
      for (const sub of phaseSubs.beforeSwap) sub(event);
      const commit = coldCommit;
      coldCommit = null;
      if (commit) flushSync(commit);
      flushDeferredNames();
      coldActive = false;
      fireAfterSwap(event);
    });
  } catch {
    coldActive = false;
    coldBridgeResolve = null;
    coldCommit = null;
    flushDeferredNames();
    pending = event;
    return;
  }
  // Safety net so a stalled or errored load can't freeze the page forever.
  coldTimeout = setTimeout(resumeColdTransition, COLD_COMMIT_TIMEOUT_MS);
  event.transition = transition;
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

// Called from each Router's `wrapUpdate` (preact-iso fork). Resumes the active
// cold transition with the page-level content commit, runs the no-VT fallback
// transition, or commits directly (a later nested/fill-in commit, the initial
// route load, or a post-load re-suspense).
export function __wrapRouteCommit(commit: () => void): void {
  if (coldBridgeResolve) {
    coldCommit = commit;
    resumeColdTransition();
  } else if (pending) {
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
