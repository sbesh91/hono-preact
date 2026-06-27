import { useReducer } from 'preact/hooks';

/**
 * Returns a stable callback that schedules a re-render of the calling
 * component. Wraps the `useReducer` counter idiom so the framework has one
 * force-update primitive (used by `useStoreSnapshot` and `useOptimistic`).
 */
export function useForceUpdate(): () => void {
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  return force;
}
