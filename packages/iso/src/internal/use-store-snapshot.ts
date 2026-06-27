import { useEffect, useRef } from 'preact/hooks';
import { useForceUpdate } from './use-force-update.js';

/**
 * Compat-free `useSyncExternalStore(subscribe, getSnapshot)`. Hand-rolled so the
 * framework never imports preact/compat (which installs global options patches).
 * Faithful to useSyncExternalStore: re-renders only when the snapshot changes by
 * Object.is, and re-reads at subscribe time to close the commit->effect tear
 * window. `subscribe` must be a stable reference (both callers pass module-level
 * functions); `getSnapshot` may be an inline closure (kept in a ref, out of the
 * effect deps).
 */
export function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const value = getSnapshot();
  const valueRef = useRef(value);
  const getSnapshotRef = useRef(getSnapshot);
  valueRef.current = value;
  getSnapshotRef.current = getSnapshot;
  const forceUpdate = useForceUpdate();

  useEffect(() => {
    const check = () => {
      const next = getSnapshotRef.current();
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        forceUpdate();
      }
    };
    check(); // subscribe-time re-read closes the commit->effect tear window
    return subscribe(check);
  }, [subscribe]);

  return value;
}
