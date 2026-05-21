import {
  type ComponentChildren,
  type FunctionComponent,
  type JSX,
} from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
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

type UseEntry = Middleware | StreamObserver<unknown, unknown>;

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
    throw new Error(
      '<PageMiddlewareHost> rendered server-side without a HonoContext.Provider. ' +
        'renderPage must wrap the prerendered tree in <HonoContext.Provider value={{ context: c }}>.'
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

type RefValue = { current: { read: () => HostResult } };

function HostConsumer({
  resultRef,
  children,
}: {
  resultRef: RefValue;
  children: ComponentChildren;
}) {
  const { outcome } = resultRef.current.read();
  const { route } = useLocation();

  if (outcome === undefined) {
    return <>{children}</>;
  }
  if (isRedirect(outcome)) {
    if (isBrowser()) {
      route(outcome.to);
      return null;
    }
    // Server: rethrow so renderPage's outer handler can translate to HTTP redirect.
    throw outcome;
  }
  if (isRender(outcome)) {
    const Alt = outcome.Component;
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
  const prevPath = useRef(location.path);
  const resultRef = useRef(wrapPromise(startChain(use, location, honoCtx)));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    resultRef.current = wrapPromise(startChain(use, location, honoCtx));
  }
  return (
    <Suspense fallback={fallback}>
      <HostConsumer resultRef={resultRef}>{children}</HostConsumer>
    </Suspense>
  );
};
