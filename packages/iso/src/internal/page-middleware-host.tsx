import {
  type ComponentChildren,
  type FunctionComponent,
  type JSX,
} from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useEffect, useRef } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { isRedirect, isRender, type Outcome } from '../outcomes.js';
import type {
  ServerMiddleware,
  ClientMiddleware,
  Middleware,
} from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';
import { dispatchServer, dispatchClient } from './middleware-runner.js';
import { partitionUse } from './use-partitioner.js';
import wrapPromise from './wrap-promise.js';
import { HonoRequestContext } from './contexts.js';

// Widest accepted observer shape: TResult defaults to `void` in
// defineStreamObserver, so `StreamObserver<unknown, unknown>` would reject
// the natural `StreamObserver<unknown, void>` produced by zero-arg
// defineStreamObserver calls. Accept any TResult here.
type AnyObserver = StreamObserver<unknown, never>;
type UseEntry = Middleware | AnyObserver;

type HostResult = { outcome: Outcome | undefined };

function startChain(
  use: ReadonlyArray<UseEntry>,
  location: RouteHook,
  honoCtx: Context | undefined
): Promise<HostResult> {
  const { middleware } = partitionUse(use);

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
      signal: (honoCtx.req?.raw?.signal ??
        new AbortController().signal) as AbortSignal,
      location,
    },
    inner: async () => undefined,
  }).then((r) =>
    r.kind === 'outcome' ? { outcome: r.outcome } : { outcome: undefined }
  );
}

type WrappedResult = { read: () => HostResult };
type RefValue = { current: WrappedResult | null };

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
  const { outcome } = wrapped ? wrapped.read() : { outcome: undefined };
  const { route } = useLocation();

  // Client-side redirect: navigate in an effect rather than during render.
  // Render-time side effects are forbidden by Suspense semantics; doing
  // route() in render would also fire on every Preact re-entry during
  // suspension resume. Keyed on the resolved target so a fresh outcome
  // for the same path doesn't refire (the outcome is cached per chain,
  // so this only changes when the path itself changes and a new chain
  // produces a redirect to a different target).
  const redirectTo = isRedirect(outcome) && isBrowser() ? outcome.to : null;
  useEffect(() => {
    if (redirectTo !== null) route(redirectTo);
    // `route` is intentionally omitted from deps: it comes from
    // useLocation() which is stable per LocationProvider mount, and
    // referencing it here would re-fire the effect on every render the
    // provider produces.
  }, [redirectTo]);

  if (outcome === undefined) {
    return <>{children}</>;
  }
  if (isRedirect(outcome)) {
    if (isBrowser()) {
      // Effect above will schedule the navigation; render nothing in the
      // meantime so the old tree doesn't briefly flash.
      return null;
    }
    // Server: rethrow so renderPage's outer handler can translate to HTTP redirect.
    throw outcome;
  }
  if (isRender(outcome)) {
    const Alt = outcome.Component;
    // Equality-by-reference semantics: each `render(Component)` call
    // returns a fresh outcome object, but the wrapped chain caches its
    // result for the lifetime of a path. Within the same path render
    // outcomes are stable. Across paths, the `resultRef` is rewrapped
    // (see PageMiddlewareHost below), so a fresh chain produces a fresh
    // outcome and Preact remounts naturally when `Alt` differs. If a
    // middleware returns the SAME component reference across paths,
    // Preact treats it as the same element and preserves state. That's
    // the documented semantic; if callers need a forced remount, they
    // can wrap the returned component or vary props.
    return <Alt />;
  }
  // Deny on the page-render path: rethrow so the outer error boundary or
  // handler can translate to the right response.
  throw outcome;
}

export const PageMiddlewareHost: FunctionComponent<{
  use?: ReadonlyArray<UseEntry>;
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ use = [], location, fallback, children }) => {
  const honoCtx = useContext(HonoRequestContext).context;
  // Lazy ref pattern. `useRef(null)` serves a dual purpose: it's the
  // "not-yet-computed" sentinel AND the persistent slot for the wrapped
  // chain result. We compute on first render and on subsequent renders
  // ONLY when the path changed. `useRef(wrapPromise(startChain(...)))`
  // would evaluate `startChain` every render before useRef decided whether
  // to keep it, which synchronously fires `dispatchServer`/`dispatchClient`
  // every render. That's O(renders) middleware invocations instead of
  // O(navigations); auth checks, analytics, redirects would all repeat.
  const resultRef = useRef<WrappedResult | null>(null);
  const prevPath = useRef(location.path);
  if (resultRef.current === null) {
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  } else if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  }
  return (
    <Suspense fallback={fallback}>
      <HostConsumer resultRef={resultRef}>{children}</HostConsumer>
    </Suspense>
  );
};
