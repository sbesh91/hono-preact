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

export function __subscribePhase(
  phase: PhaseName,
  sub: PhaseSub
): () => void {
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

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  const direction: NavDirection = getNavDirection();

  // Phase 1: beforeTransition. A separate event object is used so that
  // subscribers capturing `e` during this phase see transition === null even
  // after the dispatch completes, satisfying the "transition only from
  // beforeSwap onward" invariant.
  const eventBefore = new ViewTransitionEvent({ to, from, direction });
  for (const sub of phaseSubs.beforeTransition) sub(eventBefore);

  // Helper factories that close over the event used for phases 2-4.
  const makeFireAfterSwap = (e: ViewTransitionEvent) => () => {
    for (const sub of phaseSubs.afterSwap) sub(e);
    // Legacy subscribers fire at the afterSwap slot: after the DOM swap,
    // before the browser begins animating the new frame.
    fireLegacy(to, from);
  };

  const makeFireAfterTransition =
    (e: ViewTransitionEvent) =>
    (reason?: 'skipped' | 'unsupported' | 'aborted') => {
      if (reason !== undefined) e.reason = reason;
      for (const sub of phaseSubs.afterTransition) sub(e);
    };

  if (eventBefore._skipped) {
    flushSync(() => {});
    makeFireAfterSwap(eventBefore)();
    makeFireAfterTransition(eventBefore)('skipped');
    return;
  }

  const start = getStartViewTransition();
  if (!start) {
    flushSync(() => {});
    makeFireAfterSwap(eventBefore)();
    makeFireAfterTransition(eventBefore)('unsupported');
    return;
  }

  // Phases 2-4 share a distinct event so that event.transition is not
  // backfilled onto the eventBefore reference that beforeTransition
  // subscribers captured.
  const eventAfter = new ViewTransitionEvent({ to, from, direction });
  const fireAfterSwap = makeFireAfterSwap(eventAfter);
  const fireAfterTransition = makeFireAfterTransition(eventAfter);

  const transition = start(() => {
    for (const sub of phaseSubs.beforeSwap) sub(eventAfter);
    flushSync(() => {});
    fireAfterSwap();
  });

  // Set transition on the phases-2-4 event. Subscribers that ran inside the
  // startViewTransition callback (synchronous mock, or real async) capture
  // eventAfter by reference and read transition after dispatch returns.
  eventAfter.transition = transition;

  // Apply any types the beforeTransition phase registered, if the browser
  // supports the ViewTransition types API.
  const vtTypes = (transition as ViewTransition & {
    types?: { add(t: string): void };
  }).types;
  if (vtTypes && typeof vtTypes.add === 'function') {
    for (const t of eventBefore.types) vtTypes.add(t);
  }

  transition.finished.then(
    () => fireAfterTransition(),
    () => fireAfterTransition('aborted')
  );
}
