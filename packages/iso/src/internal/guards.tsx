import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import type { Context } from 'hono';
import { type RouteHook, useLocation } from 'preact-iso';
import { Suspense } from 'preact/compat';
import { useContext, useRef } from 'preact/hooks';
import {
  type GuardFn,
  type ServerGuardFn,
  type ClientGuardFn,
  GuardRedirect,
  type GuardResult,
  runServerGuards,
  runClientGuards,
} from '../guard.js';
import { isBrowser } from '../is-browser.js';
import wrapPromise from './wrap-promise.js';
import { GuardResultContext, HonoRequestContext } from './contexts.js';

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

function startGuardChain(
  guards: GuardFn[],
  location: RouteHook,
  honoCtx: Context | undefined
): Promise<GuardResult> {
  if (isBrowser()) {
    const active = guards.filter(
      (g): g is ClientGuardFn => g.runs === 'client'
    );
    return runClientGuards(active, { location });
  }
  const active = guards.filter((g): g is ServerGuardFn => g.runs === 'server');
  if (active.length === 0) return Promise.resolve(undefined);
  if (!honoCtx) {
    throw new Error(
      '<Guards> rendered server-side without a HonoContext.Provider. ' +
        'renderPage must wrap the prerendered tree in <HonoContext.Provider value={{ context: c }}>.'
    );
  }
  return runServerGuards(active, { c: honoCtx, location });
}

export const Guards: FunctionComponent<{
  guards?: GuardFn[];
  location: RouteHook;
  fallback?: JSX.Element;
  children: ComponentChildren;
}> = ({ guards = [], location, fallback, children }) => {
  const honoCtx = useContext(HonoRequestContext).context;
  const prevPath = useRef(location.path);
  const guardRef = useRef(
    wrapPromise(startGuardChain(guards, location, honoCtx))
  );
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    guardRef.current = wrapPromise(startGuardChain(guards, location, honoCtx));
  }
  return (
    <Suspense fallback={fallback}>
      <GuardConsumer guardRef={guardRef}>{children}</GuardConsumer>
    </Suspense>
  );
};
