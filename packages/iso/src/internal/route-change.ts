import { options } from 'preact';
import {
  ViewTransitionEvent,
  type NavDirection,
} from './view-transition-event.js';
import { getNavDirection, onNavigation } from './history-shim.js';

export type PhaseName =
  | 'beforeTransition'
  | 'beforeSwap'
  | 'afterSwap'
  | 'afterTransition';

type PhaseSub = (event: ViewTransitionEvent) => void | Promise<void>;

const phaseSubs: Record<PhaseName, Set<PhaseSub>> = {
  beforeTransition: new Set(),
  beforeSwap: new Set(),
  afterSwap: new Set(),
  afterTransition: new Set(),
};

export function __subscribePhase(phase: PhaseName, sub: PhaseSub): () => void {
  phaseSubs[phase].add(sub);
  return () => {
    phaseSubs[phase].delete(sub);
  };
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

// The preact-iso <Router>s currently mid-suspense, each represented by an opaque
// per-instance token. Non-empty means a navigation is cold and the transition
// should wait for the suspended content. A Router is "loading" from its first
// onLoadStart until its onLoadEnd.
//
// Keyed by Router identity (a token), NOT by url or a raw counter. Two cases
// break the simpler schemes:
//   - A guarded navigation to an uncached route makes ONE Router fire
//     onLoadStart TWICE before a single onLoadEnd (it suspends on its lazy view
//     module AND on its page-middleware chain). A raw counter would leak +1 and
//     the cold-flush loop below would wait out the full COLD_COMMIT_TIMEOUT_MS,
//     freezing the old page ~500ms after the new content rendered.
//   - The framework nests Routers (the top-level Routes Router plus a per-layout
//     inner Router), all reading the SAME url from one LocationProvider. On a
//     nested cold nav the outer (layout) Router commits and ends while the inner
//     (leaf) Router is still loading; keying by url would let that first end
//     empty the set early and release the transition before the leaf is ready.
// A per-Router boolean (a token; onLoadStart adds it idempotently, onLoadEnd
// removes it) handles both: the double start collapses to one token, and two
// distinct Routers are two distinct tokens.
const loadingRouters = new Set<object>();

/**
 * @internal Build the onLoadStart/onLoadEnd pair for ONE preact-iso `<Router>`.
 * Memoize per Router instance (one tracker per mounted Router) so the token
 * identity stays stable across renders.
 */
export function makeRouterLoadTracker(): {
  onLoadStart: () => void;
  onLoadEnd: () => void;
} {
  const token = {};
  return {
    onLoadStart: () => {
      loadingRouters.add(token);
      reconcileNavState();
    },
    onLoadEnd: () => {
      loadingRouters.delete(token);
      reconcileNavState();
    },
  };
}

function anyRouterLoading(): boolean {
  return loadingRouters.size > 0;
}

// Public navigation-pending observation. `loadingRouters` above is the raw
// suspense truth; this layer maintains an explicit `navPending` derived from it,
// smoothed (emit only on real change) and self-healing (a watchdog). Kept
// independent of the synchronous scheduler reads of anyRouterLoading() so it
// cannot affect cold-flush timing.
const navStateListeners = new Set<() => void>();
let notifyScheduled = false;
let navPending = false;
let navPendingWatchdog: ReturnType<typeof setTimeout> | null = null;
// A leaked token (a suspended Router that unmounts without onLoadEnd, per the
// per-nav clear comment below) would pin navPending true until the next
// navigation. Cap it so a global loading indicator self-heals on, say, an error
// page whose suspending route the ErrorBoundary unmounted.
const NAV_PENDING_MAX_MS = 10_000;

/** @internal The smoothed, self-healing "a navigation is pending" signal. */
export function getNavPending(): boolean {
  return navPending;
}

function emitNavState(): void {
  for (const l of navStateListeners) {
    try {
      l();
    } catch (err) {
      // Isolate a misbehaving subscriber so the other navigation-state
      // listeners still get notified.
      console.error('hono-preact: a navigation-state listener threw', err);
    }
  }
}

function disarmNavWatchdog(): void {
  if (navPendingWatchdog !== null) {
    clearTimeout(navPendingWatchdog);
    navPendingWatchdog = null;
  }
}

function armNavWatchdog(): void {
  disarmNavWatchdog();
  navPendingWatchdog = setTimeout(() => {
    navPendingWatchdog = null;
    if (!navPending) return;
    // A leaked token has pinned pending past any real navigation. Reclaim the
    // set (safe: a real nav's cold-flush wait ended long ago at
    // COLD_COMMIT_TIMEOUT_MS) so it cannot immediately re-raise, and drop the
    // public signal.
    loadingRouters.clear();
    navPending = false;
    emitNavState();
  }, NAV_PENDING_MAX_MS);
}

// Coalesce synchronous churn (a guarded route's double onLoadStart, nested
// Routers) into one microtask, then reconcile navPending against the raw set and
// emit only when it actually changed.
function reconcileNavState(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    const target = loadingRouters.size > 0;
    if (target === navPending) return;
    navPending = target;
    if (target) armNavWatchdog();
    else disarmNavWatchdog();
    emitNavState();
  });
}

/** @internal Subscribe to nav-pending transitions. Stable reference. */
export function subscribeNavState(onChange: () => void): () => void {
  navStateListeners.add(onChange);
  return () => navStateListeners.delete(onChange);
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
// the route's DATA (behind inner Suspense, which is not a preact-iso Router and
// so registers no in-flight load) appear in the new snapshot before the
// transition captures it.
const MORPH_PARTNER_GRACE_MS = 150;

/** @internal Test-only reset for coordinator state. */
export function __resetTransitionStateForTesting(): void {
  loadingRouters.clear();
  navStateListeners.clear();
  notifyScheduled = false;
  navPending = false;
  disarmNavWatchdog();
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
  transitionActive = false;
  skipNextTransition = false;
  // Uninstall the render scheduler (restoring Preact's debounceRendering) so
  // each test can install it fresh.
  if (schedulerInstalled) {
    options.debounceRendering = prevDebounce;
    schedulerInstalled = false;
    prevDebounce = undefined;
    if (unsubscribeNav) {
      unsubscribeNav();
      unsubscribeNav = null;
    }
  }
}

function fireAfterSwap(event: ViewTransitionEvent): void {
  for (const sub of phaseSubs.afterSwap) sub(event);
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
// loaded route. Uses only stock preact-iso props (per-Router onLoadStart/
// onLoadEnd, tracked as in-flight Router tokens above).
// ---------------------------------------------------------------------------

type ProcessFn = () => void;

let schedulerInstalled = false;
let lastHref = '';

// One-shot: when set, the next navigated flush commits without a view
// transition (see skipNextNavTransition). Consumed on that flush.
let skipNextTransition = false;

/**
 * Suppress the view transition for the next client navigation, committing the
 * render without animating. One-shot: applies to the next navigation only.
 * Call it immediately before the URL write (a `navigate`, a history
 * push/replace, or a `location.hash` assignment). `navigate(href, { transition:
 * false })` and `<NavLink transition={false}>` call it for you.
 */
export function skipNextNavTransition(): void {
  skipNextTransition = true;
}

let prevDebounce: ((process: ProcessFn) => void) | undefined;
let unsubscribeNav: (() => void) | null = null;
// True while a navigation's transition is in flight (its callback is pending or
// awaiting cold content). Lets the navigation observer abandon it.
let transitionActive = false;
// Set while a cold navigation's transition awaits a content flush; the next
// same-URL flush hands its `process` here (or `null` on supersede/timeout) so
// the transition can run it inside itself.
let coldRouteSignal: ((process: ProcessFn | null) => void) | null = null;

function defaultSchedule(process: ProcessFn): void {
  if (prevDebounce) prevDebounce(process);
  else Promise.resolve().then(process);
}

// Fired (via the history shim) at navigation time, before the re-render. If a
// transition from a previous navigation is still in flight, abandon it here:
// Preact may coalesce the new navigation's render into the in-flight one, so
// scheduleRender never sees it and its own supersede branch can't fire.
function onNavObserved(): void {
  if (!transitionActive && !coldRouteSignal) return;
  navGen++; // the in-flight callback bows out at its next navGen check
  transitionActive = false;
  if (coldRouteSignal) {
    const resolve = coldRouteSignal;
    coldRouteSignal = null;
    if (coldTimeout !== null) {
      clearTimeout(coldTimeout);
      coldTimeout = null;
    }
    resolve(null);
  }
}

/**
 * @internal Install the view-transition render scheduler (client only).
 *
 * Takes ownership of `options.debounceRendering`: it captures the previous value
 * as `prevDebounce` (delegated to for every non-navigation flush) and installs
 * `scheduleRender` in its place. This assumes nothing else permanently overrides
 * `options.debounceRendering` afterward. `preact/compat`'s `flushSync` swaps it
 * temporarily and restores it, so that composes fine; a second permanent
 * override would shadow this scheduler (the install is idempotent, so calling it
 * twice is a no-op, not a double-install). Reversed by
 * `__resetTransitionStateForTesting`.
 */
export function installNavTransitionScheduler(): void {
  if (schedulerInstalled) return;
  if (typeof document === 'undefined' || typeof location === 'undefined')
    return;
  schedulerInstalled = true;
  lastHref = location.href;
  prevDebounce = options.debounceRendering;
  options.debounceRendering = scheduleRender;
  unsubscribeNav = onNavigation(onNavObserved);
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

  if (navigated) {
    // Reset the in-flight Router set at the start of a navigation. A previous
    // route's loads are abandoned by a new navigation, and preact-iso fires
    // onLoadStart without a matching onLoadEnd when a still-suspended Router
    // unmounts (it emits onLoadEnd only on a committed render, not on unmount).
    // Left alone, those leaked tokens would make this nav (and later ones) look
    // perpetually cold and burn the cold-load timeout. This nav re-populates the
    // set as its own Routers suspend.
    loadingRouters.clear();
    reconcileNavState();
  }

  const skip = navigated && skipNextTransition;
  if (navigated) skipNextTransition = false; // one-shot: consumed on the nav flush
  lastHref = href;
  const start = navigated && !skip ? getStartViewTransition() : undefined;
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

// Elements carrying an inline `view-transition-name`. The attribute selector
// lets the browser filter natively instead of walking every node in JS — this
// runs on the frozen hot path (inside the transition callback, possibly once per
// grace tick), so the candidate set should be as small as possible. The selector
// is a substring match on the serialized `style` attribute, so we still confirm
// each match by reading the resolved property below.
function queryVtNamedElements(): HTMLElement[] {
  if (typeof document === 'undefined' || !document.querySelectorAll) return [];
  return Array.from(
    document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')
  );
}

// The view-transition-names currently applied in the document, mapped to the
// element carrying each (first wins on the off-chance a name is duplicated).
// Element identity is what lets the grace tell a persistent name (still on its
// original node) from a freshly-materialised morph endpoint (see below).
function collectVtNameElements(): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const el of queryVtNamedElements()) {
    const n = el.style?.getPropertyValue?.('view-transition-name');
    if (n && !map.has(n)) map.set(n, el);
  }
  return map;
}

// Whether a name from the outgoing route now appears on a DIFFERENT (or new)
// element than it did before the swap — i.e. a genuine destination morph
// endpoint has materialised. A name still carried by its ORIGINAL element is
// persistent chrome (e.g. a parent layout's title that doesn't unmount across
// the nav). Such a name pairs trivially on its own and must NOT satisfy the
// grace: if it did, the grace would be skipped while the real data-loaded
// partner (which loads behind inner Suspense, not a preact-iso Router, so it
// registers no in-flight load) is still pending, and the new snapshot would be
// captured without it.
function hasFreshMorphPartner(oldNamed: Map<string, Element>): boolean {
  if (oldNamed.size === 0) return false;
  for (const el of queryVtNamedElements()) {
    const n = el.style?.getPropertyValue?.('view-transition-name');
    if (n && oldNamed.has(n) && oldNamed.get(n) !== el) return true;
  }
  return false;
}

function runNavTransition(
  process: ProcessFn,
  start: (cb: () => void | Promise<void>) => ViewTransition
): void {
  const from = lastPath;
  // The named elements present in the outgoing route, keyed by name. Used to
  // know when a morph partner has freshly appeared in the new route (see the
  // grace wait below) — element identity distinguishes a persistent name (same
  // node) from a destination endpoint that re-claims the name on a new node.
  const oldNamed = collectVtNameElements();
  const myGen = ++navGen;
  transitionActive = true;
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
        // transition until every suspended Router has loaded (no Router is still
        // in flight), i.e. the page-level shell and its nested leaves are ready.
        while (anyRouterLoading()) {
          const contentProcess = await waitForColdFlush(
            myGen,
            COLD_COMMIT_TIMEOUT_MS
          );
          if (navGen !== myGen) return;
          if (!contentProcess) break; // timed out waiting
          contentProcess();
        }
        // If the outgoing route had named elements but none has a FRESH partner
        // in the new shell yet, the partner may load with the route's DATA
        // (behind inner Suspense, which registers no in-flight Router, e.g. a
        // list whose items come from a loader). Wait briefly for it so the morph can
        // pair. "Fresh" ignores names that merely persisted on their original
        // element (parent-layout chrome); otherwise such a name would satisfy
        // the check immediately and the real partner would never be awaited.
        if (oldNamed.size > 0 && !hasFreshMorphPartner(oldNamed)) {
          while (!hasFreshMorphPartner(oldNamed)) {
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
      transitionActive = false; // reached only when still current
    });
  } catch {
    // Non-conformant startViewTransition: just flush and fire the post phases.
    transitionActive = false;
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
