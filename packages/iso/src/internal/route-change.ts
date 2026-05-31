import { options } from 'preact';
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

// Cold-navigation state: a navigation's transition holds until the suspending
// route's content flushes have all run (see the scheduler below).
let coldTimeout: ReturnType<typeof setTimeout> | null = null;
// Bumped per navigation so a superseded transition's (async) callback bows out.
let navGen = 0;
// Cap on how long a navigation holds the old snapshot waiting for a suspending
// route's content. Past it the navigation completes without finishing the
// transition rather than freezing the page on a slow/stalled load.
const COLD_COMMIT_TIMEOUT_MS = 500;
// Extra grace, after the shell is ready, to let a morph partner that loads with
// the route's DATA (behind inner Suspense, which doesn't move loadingDepth)
// appear in the new snapshot before the transition captures it.
const MORPH_PARTNER_GRACE_MS = 150;

/** @internal Test-only reset for coordinator state. */
export function __resetTransitionStateForTesting(): void {
  loadingDepth = 0;
  navGen = 0;
  lastPath =
    typeof location !== 'undefined'
      ? location.pathname + location.search
      : undefined;
  coldRouteSignal = null;
  if (coldTimeout !== null) {
    clearTimeout(coldTimeout);
    coldTimeout = null;
  }
  // Uninstall the render scheduler (restoring Preact's debounceRendering) so
  // each test can install it fresh.
  if (schedulerInstalled) {
    options.debounceRendering = prevDebounce;
    schedulerInstalled = false;
    prevDebounce = undefined;
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

// ---------------------------------------------------------------------------
// debounceRendering-based scheduler (no preact-iso navigation hooks required).
//
// Preact calls `options.debounceRendering(process)` to schedule a render flush
// (this is the seam `flushSync` uses). We override it: when a flush is the
// result of a navigation (the URL changed since the last flush, because the
// router pushes state before re-rendering), wrap that flush in a view
// transition so the browser captures the current route as the old snapshot
// before `process()` swaps in the new one. Everything else schedules normally.
//
// Cold (suspending) routes commit their content in a later, same-URL flush; the
// in-flight transition routes that flush into itself so the new snapshot is the
// loaded route. Uses only stock preact-iso props (onLoadStart/onLoadEnd via
// `loadingDepth`).
// ---------------------------------------------------------------------------

type ProcessFn = () => void;

let schedulerInstalled = false;
let lastHref = '';
let prevDebounce: ((process: ProcessFn) => void) | undefined;
// Set while a cold navigation's transition awaits a content flush; the next
// same-URL flush hands its `process` here (or `null` on supersede/timeout) so
// the transition can run it inside itself.
let coldRouteSignal: ((process: ProcessFn | null) => void) | null = null;

function defaultSchedule(process: ProcessFn): void {
  if (prevDebounce) prevDebounce(process);
  else Promise.resolve().then(process);
}

/** @internal Install the view-transition render scheduler (client only). */
export function installNavTransitionScheduler(): void {
  if (schedulerInstalled) return;
  if (typeof document === 'undefined' || typeof location === 'undefined')
    return;
  schedulerInstalled = true;
  lastHref = location.href;
  prevDebounce = options.debounceRendering;
  options.debounceRendering = scheduleRender;
}

function scheduleRender(process: ProcessFn): void {
  const href = location.href;
  const navigated = href !== lastHref;

  // The content flush for an in-flight cold navigation (same URL): hand it back
  // to that transition so it lands in the new snapshot.
  if (coldRouteSignal && !navigated) {
    const resolve = coldRouteSignal;
    coldRouteSignal = null;
    if (coldTimeout !== null) {
      clearTimeout(coldTimeout);
      coldTimeout = null;
    }
    resolve(process); // the transition's callback runs `process()` itself
    return;
  }

  // A new navigation arrived while a cold one was still loading: abandon it.
  if (coldRouteSignal && navigated) {
    navGen++;
    const resolve = coldRouteSignal;
    coldRouteSignal = null;
    if (coldTimeout !== null) {
      clearTimeout(coldTimeout);
      coldTimeout = null;
    }
    resolve(null);
  }

  lastHref = href;
  const start = navigated ? getStartViewTransition() : undefined;
  if (!start) {
    defaultSchedule(process);
    return;
  }
  runNavTransition(process, start);
}

// Wait for the next content flush of an in-flight cold navigation (routed here
// by scheduleRender), or null on timeout/supersede.
function waitForColdFlush(
  myGen: number,
  timeoutMs: number
): Promise<ProcessFn | null> {
  return new Promise((resolve) => {
    coldRouteSignal = resolve;
    coldTimeout = setTimeout(() => {
      if (navGen === myGen && coldRouteSignal) {
        coldRouteSignal = null;
        coldTimeout = null;
        resolve(null);
      }
    }, timeoutMs);
  });
}

// The view-transition-names currently applied in the document (inline styles).
function collectVtNames(): Set<string> {
  const names = new Set<string>();
  if (typeof document === 'undefined' || !document.querySelectorAll)
    return names;
  document.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const n = el.style?.getPropertyValue?.('view-transition-name');
    if (n) names.add(n);
  });
  return names;
}

// Whether any currently-applied view-transition-name was also in `oldNames` —
// i.e. a morph pair (same name old + new) is present.
function hasMorphPartner(oldNames: Set<string>): boolean {
  if (
    oldNames.size === 0 ||
    typeof document === 'undefined' ||
    !document.querySelectorAll
  ) {
    return false;
  }
  const els = document.querySelectorAll<HTMLElement>('*');
  for (const el of els) {
    const n = el.style?.getPropertyValue?.('view-transition-name');
    if (n && oldNames.has(n)) return true;
  }
  return false;
}

function runNavTransition(
  process: ProcessFn,
  start: (cb: () => void | Promise<void>) => ViewTransition
): void {
  const from = lastPath;
  // The names present in the outgoing route — used to know when a morph partner
  // has appeared in the new route (see the grace wait below).
  const oldNames = collectVtNames();
  const myGen = ++navGen;
  let transition: ViewTransition;
  let event: ViewTransitionEvent | undefined;
  try {
    transition = start(async () => {
      // The old snapshot has been captured. Flush the navigation render.
      process();
      if (navGen !== myGen) return;
      event = buildEvent(from);
      event.transition = transition;
      applyTypes(transition, event.types);

      if (event._skipped) {
        skipTransition(transition);
      } else {
        for (const sub of phaseSubs.beforeSwap) sub(event);
        // Cold: the route suspended. Keep routing its content flushes into the
        // transition until every route module has loaded (loadingDepth back to
        // 0) — the page-level shell.
        while (loadingDepth > 0) {
          const contentProcess = await waitForColdFlush(
            myGen,
            COLD_COMMIT_TIMEOUT_MS
          );
          if (navGen !== myGen) return;
          if (!contentProcess) break; // timed out waiting
          contentProcess();
        }
        // If the outgoing route had named elements but none has a partner in the
        // new shell yet, the partner may load with the route's DATA (behind
        // inner Suspense, which doesn't move loadingDepth — e.g. a list whose
        // items come from a loader). Wait briefly for it so the morph can pair.
        if (oldNames.size > 0 && !hasMorphPartner(oldNames)) {
          while (!hasMorphPartner(oldNames)) {
            const contentProcess = await waitForColdFlush(
              myGen,
              MORPH_PARTNER_GRACE_MS
            );
            if (navGen !== myGen) return;
            if (!contentProcess) break; // grace expired — capture as-is
            contentProcess();
          }
        }
      }

      if (navGen !== myGen) return;
      fireAfterSwap(event);
    });
  } catch {
    // Non-conformant startViewTransition: just flush and fire the post phases.
    process();
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
// Production navigations are driven by the scheduler (installNavTransition
// scheduler); this drives the same phase/type/lifecycle machinery directly for
// callers that change the route outside the normal navigation flow (and in unit
// tests).
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
