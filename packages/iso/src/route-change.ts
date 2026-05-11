import { useEffect, useRef } from 'preact/hooks';
import { __subscribeRouteChange } from './internal/route-change.js';

export type RouteChangeHandler = (to: string, from: string | undefined) => void;

export function useRouteChange(handler: RouteChangeHandler): void {
  // Keep the latest handler in a ref so rerenders don't churn the subscription.
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    return __subscribeRouteChange((to, from) => ref.current(to, from));
  }, []);
}
