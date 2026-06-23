import { useEffect, useReducer } from 'preact/hooks';

/**
 * Minimal `useSyncExternalStore(subscribe, getSnapshot)` for hono-preact-ui.
 *
 * hono-preact-ui is standalone and depends only on preact, so it does NOT use
 * preact/compat's `useSyncExternalStore` (importing compat would install global
 * preact-renderer `options` patches just to get this hook). Implementation is a
 * `useReducer` force-update driven by the store's `subscribe`, reading
 * `getSnapshot` during render.
 *
 * Deviation from React 18's `useSyncExternalStore`: it does not re-read the
 * snapshot at subscribe time to close the render-to-effect tear window. ui's
 * stores are synchronous in-memory singletons, so that window is empty in
 * practice.
 *
 * This is an intentional copy of the framework's internal hook of the same
 * shape: ui stays standalone, so per the ui/iso convention it keeps its own
 * rather than sharing a cross-package module.
 *
 * @param subscribe   Registers `onStoreChange` and returns an unsubscribe fn.
 * @param getSnapshot Reads the current store value; called on every render.
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const [, forceUpdate] = useReducer((n: number, _action: void) => n + 1, 0);
  useEffect(() => subscribe(() => forceUpdate()), [subscribe]);
  return getSnapshot();
}
