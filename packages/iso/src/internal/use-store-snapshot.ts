import { useEffect, useReducer } from 'preact/hooks';

/**
 * Minimal compat-free `useSyncExternalStore(subscribe, getSnapshot)`. Hand-rolled
 * so the framework never imports preact/compat (which installs global options
 * patches). useReducer force-update driven by `subscribe`; snapshot read on render.
 * Deviation: does not re-read the snapshot at subscribe time. These are synchronous
 * in-memory stores written only by post-mount events, so the tear window is empty.
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const [, forceUpdate] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => forceUpdate()), [subscribe]);
  return getSnapshot();
}
