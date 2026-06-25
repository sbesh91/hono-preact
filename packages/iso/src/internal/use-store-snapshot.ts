import { useEffect, useReducer } from 'preact/hooks';

/**
 * Minimal compat-free `useSyncExternalStore(subscribe, getSnapshot)`. Hand-rolled
 * so the framework never imports preact/compat (which installs global options
 * patches). useReducer force-update driven by `subscribe`; snapshot read on render.
 * Deviation: does not re-read the snapshot at subscribe time. These are synchronous
 * in-memory stores written only by post-mount events, so the tear window is empty.
 *
 * Contract: `subscribe` must be a stable reference. The `useEffect(..., [subscribe])`
 * dep means an unstable `subscribe` (e.g. an inline closure) would re-subscribe every
 * render; both current callers pass module-level functions, which satisfies this.
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const [, forceUpdate] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => forceUpdate()), [subscribe]);
  return getSnapshot();
}
