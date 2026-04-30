import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
import {
  type GuardFn,
  GuardRedirect,
  type GuardResult,
  runGuards,
} from './guard.js';
import { isBrowser } from './is-browser.js';
import wrapPromise from './wrap-promise.js';
import { GuardResultContext } from './contexts.js';

export function useGuardResult(): GuardResult | null {
  return useContext(GuardResultContext);
}

export const GuardGate: FunctionComponent<{
  result: GuardResult | null;
  children: ComponentChildren;
}> = ({ result, children }) => {
  const { route } = useLocation();
  if (result && 'redirect' in result) {
    if (isBrowser()) {
      route(result.redirect);
      return null;
    }
    throw new GuardRedirect(result.redirect);
  }
  if (result && 'render' in result) {
    const Fallback = result.render;
    return <Fallback />;
  }
  return <>{children}</>;
};

type GuardRefValue = {
  current: { read: () => GuardResult };
};

function GuardConsumer({
  guardRef,
  children,
}: {
  guardRef: GuardRefValue;
  children: ComponentChildren;
}) {
  const result = (guardRef.current.read() ?? null) as GuardResult | null;
  return (
    <GuardResultContext.Provider value={result}>
      <GuardGate result={result}>{children}</GuardGate>
    </GuardResultContext.Provider>
  );
}

export const Guards: FunctionComponent<{
  server?: GuardFn[];
  client?: GuardFn[];
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ server = [], client = [], location, fallback, children }) => {
  const guards = isBrowser() ? client : server;
  const prevPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(runGuards(guards, { location })));
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    guardRef.current = wrapPromise(runGuards(guards, { location }));
  }
  return (
    <Suspense fallback={fallback}>
      <GuardConsumer guardRef={guardRef}>{children}</GuardConsumer>
    </Suspense>
  );
};
