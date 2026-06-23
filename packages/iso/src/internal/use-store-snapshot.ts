import { useEffect, useReducer } from 'preact/hooks';

/**
 * Minimal, compat-free `useSyncExternalStore(subscribe, getSnapshot)`.
 *
 * Hand-rolled rather than imported from `preact/compat` so the framework never
 * loads compat and the global preact-renderer `options` patches it installs at
 * import time. Implementation is a `useReducer` force-update driven by the
 * store's `subscribe`, with the snapshot read via `getSnapshot` during render.
 *
 * Deviation from React 18's `useSyncExternalStore`: this does NOT re-read the
 * snapshot at subscribe time to close the render-to-effect tear window. The
 * framework's stores (action results, form-submit status) are synchronous
 * in-memory stores written only by post-mount submit events, so that window is
 * empty in practice. See docs/superpowers/specs/2026-06-23-drop-preact-compat-design.md.
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
