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

// Types computed for the most recent navigation. A suspending route's content
// commits after this dispatch's transition (see define-routes' wrapRouteUpdate),
// so that deferred commit re-applies these types to its own transition to keep
// the same direction-driven styling as a synchronous navigation. `null` until
// the first navigation is dispatched, which lets the deferred-commit wrapper
// distinguish a real navigation from the initial route load (whose lazy view
// resolving must NOT trigger a transition).
let __lastNavTypes: string[] | null = null;
export function __getLastNavTypes(): string[] | null {
  return __lastNavTypes;
}

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  ensureDefaultTypes();
  const direction: NavDirection = getNavDirection();
  const event = new ViewTransitionEvent({ to, from, direction });

  for (const sub of phaseSubs.beforeTransition) sub(event);

  // Remember the types for this navigation so a deferred suspending-route
  // commit can re-apply them to its own transition.
  __lastNavTypes = [...event.types];

  const fireAfterSwap = () => {
    for (const sub of phaseSubs.afterSwap) sub(event);
    // Legacy subscribers fire at the afterSwap slot: after the DOM swap,
    // before the browser begins animating the new frame.
    fireLegacy(to, from);
  };

  const fireAfterTransition = (
    reason?: 'skipped' | 'unsupported' | 'aborted'
  ): void => {
    if (reason !== undefined) event.reason = reason;
    for (const sub of phaseSubs.afterTransition) sub(event);
  };

  if (event._skipped) {
    flushSync(() => {});
    fireAfterSwap();
    fireAfterTransition('skipped');
    return;
  }

  const start = getStartViewTransition();
  if (!start) {
    flushSync(() => {});
    fireAfterSwap();
    fireAfterTransition('unsupported');
    return;
  }

  const transition = start(() => {
    flushSync(() => {});
  });
  // Set event.transition before firing beforeSwap so all subsequent phase
  // subscribers see a non-null transition. In real browsers startViewTransition
  // invokes the callback asynchronously, meaning transition is set here before
  // the browser calls the update function. In synchronous test mocks the
  // callback returns before start() does, so we set transition here (after
  // start() returns) and then fire the post-swap phases manually.
  event.transition = transition;
  for (const sub of phaseSubs.beforeSwap) sub(event);
  fireAfterSwap();

  // Apply types accumulated across all phases. beforeTransition and beforeSwap
  // have both run by this point, so the full set of types is available here.
  const vtTypes = (
    transition as ViewTransition & {
      types?: { add(t: string): void };
    }
  ).types;
  if (vtTypes && typeof vtTypes.add === 'function') {
    for (const t of event.types) vtTypes.add(t);
  }

  transition.finished.then(
    () => fireAfterTransition(),
    () => fireAfterTransition('aborted')
  );
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
