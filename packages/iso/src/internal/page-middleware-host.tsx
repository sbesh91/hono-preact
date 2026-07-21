import { type ComponentChildren, type FunctionComponent } from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { isRedirect, isRender, type Outcome } from '../outcomes.js';
import type {
  ServerMiddleware,
  ClientMiddleware,
} from '../define-middleware.js';
import { dispatchServer, dispatchClient } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';
import type { UseEntry } from './use-entry.js';
import wrapPromise from './wrap-promise.js';
import { useForceUpdate } from './use-force-update.js';
import { hasClientNavigated } from './history-shim.js';
import { HonoRequestContext } from './contexts.js';

type HostResult = { outcome: Outcome | undefined };

// The live pathname (NO query string). Used to detect that a navigation has
// superseded a route whose chain is still settling. Compared at PATHNAME
// granularity on purpose: SuspenseHost re-dispatches the chain only when
// `location.path` (pathname) changes, so a same-path, query-only navigation is
// NOT a supersession of this route and must not trip the self-heal gate (a
// pathname+query compare froze the route on query-only navs). Distinct from
// route-change.ts's `currentPath()` (pathname+query), which keys the transition
// from/to. Call only under isBrowser().
function currentPathname(): string {
  return typeof location !== 'undefined' ? location.pathname : '';
}

function startChain(
  use: ReadonlyArray<UseEntry>,
  location: RouteHook,
  honoCtx: Context | undefined
): Promise<HostResult> {
  // Label the layer the way composeServerChain labels the same tier, so a
  // malformed entry reports "the page `use` for /admin/:id" rather than a
  // bare index into an anonymous array.
  const { middleware } = partitionUse(
    use,
    `the page \`use\` for ${location.path}`
  );

  if (isBrowser()) {
    const client = middleware.filter(
      (m): m is ClientMiddleware => m.runs === 'client'
    );
    if (client.length === 0) return Promise.resolve({ outcome: undefined });
    return dispatchClient({
      middleware: client,
      ctx: { scope: 'page', location },
      inner: async () => undefined,
    }).then((r) =>
      r.kind === 'outcome' ? { outcome: r.outcome } : { outcome: undefined }
    );
  }

  const server = middleware.filter(
    (m): m is ServerMiddleware => m.runs === 'server'
  );
  if (server.length === 0) return Promise.resolve({ outcome: undefined });
  if (!honoCtx) {
    // Reject (don't throw synchronously). `wrapPromise` consumes a Promise;
    // a sync throw here never reaches it, so the Suspense/ErrorBoundary path
    // ends up surfacing a coerced "[object Object]"-style message instead of
    // this explicit one. Returning a rejected promise routes the message
    // through `wrapPromise.read()` -> the boundary's error state correctly.
    return Promise.reject(
      new Error(
        '<PageMiddlewareHost> rendered server-side without a HonoContext.Provider. ' +
          'renderPage must wrap the prerendered tree in <HonoContext.Provider value={{ context: c }}>.'
      )
    );
  }
  return dispatchServer({
    middleware: server,
    ctx: {
      scope: 'page',
      c: honoCtx,
      signal: honoCtx.req?.raw?.signal ?? new AbortController().signal,
      location,
    },
    inner: async () => undefined,
  }).then((r) =>
    r.kind === 'outcome' ? { outcome: r.outcome } : { outcome: undefined }
  );
}

// Derived from the source of truth so the shape can't drift from wrapPromise.
type WrappedResult = ReturnType<typeof wrapPromise<HostResult>>;
type RefValue = { current: WrappedResult | null };

/**
 * Applies a settled host outcome to the rendered tree. Shared rendering logic
 * for both host strategies (Suspense and Deferred).
 */
function renderOutcome(
  outcome: Outcome | undefined,
  children: ComponentChildren
): ComponentChildren {
  if (outcome === undefined) {
    return <>{children}</>;
  }
  if (isRedirect(outcome)) {
    if (isBrowser()) {
      // The navigation is scheduled in an effect; render nothing meanwhile so
      // the old tree doesn't briefly flash.
      return null;
    }
    // Server: rethrow so renderPage's outer handler can translate to an HTTP redirect.
    throw outcome;
  }
  if (isRender(outcome)) {
    const Alt = outcome.Component;
    // Equality-by-reference semantics: each `render(Component)` call returns a
    // fresh outcome object, but the wrapped chain caches its result for the
    // lifetime of a path. Within the same path render outcomes are stable.
    // Across paths the chain is re-dispatched, so a fresh chain produces a
    // fresh outcome and Preact remounts naturally when `Alt` differs. If a
    // middleware returns the SAME component reference across paths, Preact
    // treats it as the same element and preserves state. That's the documented
    // semantic; callers needing a forced remount can wrap the component or vary
    // props.
    return <Alt />;
  }
  // Deny on the page-render path: rethrow so the outer error boundary or
  // handler can translate to the right response.
  throw outcome;
}

/**
 * Suspense strategy: suspend on the middleware chain and render its outcome.
 * Used for SSR (prerender awaits the suspension) and for post-navigation client
 * renders (no hydration to mismatch, a fallback is fine while the chain runs).
 */
function HostConsumer({
  resultRef,
  children,
}: {
  resultRef: RefValue;
  children: ComponentChildren;
}) {
  // resultRef.current is populated by the parent before this consumer
  // renders; the null branch is just a type-narrow guard.
  const wrapped = resultRef.current;
  // Self-heal: chain suspension via wrapPromise has no self-update of its own,
  // so when the Router is the boundary (it holds [cur, prev] but does not deeply
  // re-render this suspended consumer) the incoming route would never commit.
  // Subscribe to the chain promise's settlement and re-render THIS component on
  // resolve, mirroring preact-iso `lazy`'s self-update. Re-subscribe whenever
  // the wrapped result changes (a new path produces a fresh wrapPromise).
  const force = useForceUpdate();
  const subscribedTo = useRef<WrappedResult | null>(null);
  // Browser-only: on the server the prerender drives suspension resume by
  // awaiting the thrown promise and re-rendering, so subscribing here would be
  // dead work (and force() a retained no-op closure) on the SSR hot path.
  if (isBrowser() && wrapped && subscribedTo.current !== wrapped) {
    subscribedTo.current = wrapped;
    const pending = wrapped.peek();
    if (pending.status === 'pending') {
      // The PATHNAME this chain was dispatched for. If a newer navigation has
      // moved the app to a different path by the time the chain settles, this
      // route is being held alive as the Router's `prev` (superseded).
      // Re-rendering it then would commit stale content and, worse, fire its
      // stale redirect effect (route() below), overriding the user's current
      // navigation. Gate the self-heal on the live pathname still matching the
      // dispatch pathname. Pathname, not full URL: a query-only navigation
      // re-renders this same route without re-dispatching (SuspenseHost keys on
      // location.path), so it must still self-heal rather than be suppressed.
      const dispatchedAt = currentPathname();
      pending.settled.then(() => {
        if (currentPathname() !== dispatchedAt) return;
        // If this consumer unmounted before the chain settled, force() is a
        // harmless no-op in Preact; the closure (only `force` + `dispatchedAt`)
        // is retained until the chain settles, which is bounded by the request.
        force();
      });
    }
  }
  const { outcome } = wrapped ? wrapped.read() : { outcome: undefined };
  const { route } = useLocation();

  // Client-side redirect: navigate in an effect rather than during render
  // (render-time side effects are forbidden by Suspense semantics, and route()
  // in render would also re-fire on every Preact re-entry during suspension
  // resume). Keyed on the resolved target so a fresh outcome for the same path
  // doesn't refire.
  const redirectTo = isRedirect(outcome) && isBrowser() ? outcome.to : null;
  useEffect(() => {
    if (redirectTo === null) return;
    // A plain SPA route() is correct here. This consumer only runs on the
    // server (where the redirect outcome is thrown above, not routed) and for
    // post-navigation client renders; initial-load redirects are handled by
    // DeferredHost, which renders the SSR content during hydration so there is
    // no server-committed tree for the Router to orphan. (The
    // orphan-on-hydration-mismatch is expected Preact behavior, see
    // preactjs/preact#4442.)
    route(redirectTo);
    // `route` is intentionally omitted from deps: it comes from useLocation()
    // which is stable per LocationProvider mount, and referencing it here would
    // re-fire the effect on every render the provider produces.
  }, [redirectTo]);

  return renderOutcome(outcome, children);
}

/**
 * Deferred strategy: used on the INITIAL document load (browser, before any
 * client navigation). Renders the server-rendered children during hydration so
 * the hydrated DOM matches SSR, then runs the client chain post-hydration and
 * applies its outcome as a normal update. This avoids a Suspense boundary
 * resolving to non-SSR content mid-hydration, which orphans the server route
 * DOM (expected Preact behavior, preactjs/preact#4442) and stacks the redirect
 * target on top (the "client redirect double-mount").
 *
 * Timing contract: on the initial load the client middleware runs AFTER
 * hydration (in the effect), not before first paint. The server already
 * authorized and rendered this content, so a client guard is advisory here and
 * applies once hydrated; anything it would redirect away from is already on
 * screen from SSR, so deferring exposes nothing new. Post-navigation renders
 * take SuspenseHost, where the chain blocks the render as before.
 *
 * Known limitation: this matches the COMMON case where the server passed and
 * rendered `children`. If a SERVER middleware instead rendered an alternative
 * (so SSR markup != children) and the client produces no matching outcome, the
 * client still renders `children` and the SSR/client mismatch is on the user -
 * the framework does not transmit the server outcome to the client. This is
 * pre-existing (it predates the deferred strategy) and out of scope here.
 */
function DeferredHost({
  use,
  location,
  honoCtx,
  children,
}: {
  use: ReadonlyArray<UseEntry>;
  location: RouteHook;
  honoCtx: Context | undefined;
  children: ComponentChildren;
}) {
  const { route } = useLocation();
  // null = chain not yet settled, or settled to a redirect/pass: keep rendering
  // the server children. A settled render()/deny outcome is stored so it can be
  // swapped in via a normal post-hydration update.
  const [applied, setApplied] = useState<HostResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset to the server children before re-dispatching, so a stale render()
    // outcome from a previous path cannot linger if this host is ever reused
    // across a path change (in practice it only handles the initial load, but
    // a persisted layout host could in principle see location.path change).
    setApplied(null);
    startChain(use, location, honoCtx).then((result) => {
      if (cancelled) return;
      if (isRedirect(result.outcome)) {
        // SPA navigate from the fully hydrated tree. Because the server's
        // content (not null) was rendered during hydration, there is no
        // orphaned route DOM for the Router to stack the target on top of.
        route(result.outcome.to);
      } else if (result.outcome !== undefined) {
        // render() / deny: surface after hydration via a normal update.
        setApplied(result);
      }
      // undefined (chain passed): keep the already-rendered children.
    });
    return () => {
      cancelled = true;
    };
    // Re-dispatch if the path changes (mirrors SuspenseHost's per-path dispatch).
  }, [location.path]);

  if (applied === null) return <>{children}</>;
  return renderOutcome(applied.outcome, children);
}

/**
 * Suspense strategy wrapper. Lazily dispatches the chain once per path (see the
 * lazy-ref note below) and renders the outcome through HostConsumer.
 *
 * There is no interposed boundary: the promise HostConsumer throws bubbles to
 * the nearest preact-iso Router (the suspense boundary), which keeps the
 * outgoing route mounted while the chain resolves. HostConsumer self-heals on
 * resolve (it subscribes to the chain promise) so the incoming route commits;
 * see HostConsumer. Thrown framework outcomes (render/deny) are not promises,
 * so the Router ignores them: on the server they reach renderPage's handler;
 * on the client they propagate uncaught exactly as before (the removed boundary
 * had no onError and never caught outcomes either).
 */
function SuspenseHost({
  use,
  location,
  honoCtx,
  children,
}: {
  use: ReadonlyArray<UseEntry>;
  location: RouteHook;
  honoCtx: Context | undefined;
  children: ComponentChildren;
}) {
  // Lazy ref pattern. `useRef(null)` serves a dual purpose: it's the
  // "not-yet-computed" sentinel AND the persistent slot for the wrapped chain
  // result. We compute on first render and on subsequent renders ONLY when the
  // path changed. `useRef(wrapPromise(startChain(...)))` would evaluate
  // `startChain` every render before useRef decided whether to keep it, which
  // synchronously fires `dispatchServer`/`dispatchClient` every render. That's
  // O(renders) middleware invocations instead of O(navigations); auth checks,
  // analytics, redirects would all repeat.
  const resultRef = useRef<WrappedResult | null>(null);
  const prevPath = useRef(location.path);
  if (resultRef.current === null) {
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  } else if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  }
  // No interposed boundary. The promise HostConsumer throws bubbles to the
  // nearest preact-iso Router, which holds [cur, prev] alive while the chain
  // resolves instead of tearing the outgoing route to blank. Outcomes
  // (render/deny/redirect) are not promises, so the Router ignores them: deny
  // throws propagate (server: to renderPage; client: unchanged from before,
  // since the old boundary had no onError and never caught outcomes either),
  // redirect/render are handled inside HostConsumer. The server prerender
  // catches suspensions globally; DeferredHost (initial load) never suspends.
  // Contract: SuspenseHost now requires an ancestor Router as its boundary.
  return <HostConsumer resultRef={resultRef}>{children}</HostConsumer>;
}

export const PageMiddlewareHost: FunctionComponent<{
  use?: ReadonlyArray<UseEntry>;
  location: RouteHook;
  children: ComponentChildren;
}> = ({ use = [], location, children }) => {
  const honoCtx = useContext(HonoRequestContext).context;
  // Choose the render strategy ONCE per mount so the hook order stays stable
  // across renders (hasClientNavigated() flips to true after the first
  // navigation, which would otherwise change which child - and its hooks - we
  // render).
  //
  // Initial document load (browser, no navigation yet) -> DeferredHost: a
  // Suspense boundary that suspends during hydration and resolves to non-SSR
  // content (e.g. null for a redirect) orphans the server-rendered route DOM
  // (expected Preact behavior, preactjs/preact#4442), which the Router then
  // stacks the redirect target on top of. Rendering the server children during
  // hydration and applying the client outcome afterwards removes that mismatch.
  //
  // Server render and post-navigation client renders have no hydration to
  // mismatch, so the Suspense path (suspend on the chain, render the outcome)
  // is correct there.
  const deferRef = useRef(isBrowser() && !hasClientNavigated());
  if (deferRef.current) {
    return (
      <DeferredHost use={use} location={location} honoCtx={honoCtx}>
        {children}
      </DeferredHost>
    );
  }
  return (
    <SuspenseHost use={use} location={location} honoCtx={honoCtx}>
      {children}
    </SuspenseHost>
  );
};
