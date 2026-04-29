import { type ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { GuardRedirect, type GuardResult } from './guard.js';
import { isBrowser } from './is-browser.js';

type GuardGateProps = {
  result: GuardResult | null;
  children: ComponentChildren;
};

export function GuardGate({ result, children }: GuardGateProps) {
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
}
