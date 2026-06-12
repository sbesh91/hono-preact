import { useCallback, useContext } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';
import { ActiveLoaderIdContext } from './internal/contexts.js';
import type { LoaderRef } from './define-loader.js';

/** How to update loader caches after an action commits. Same vocabulary as
 * `useAction`'s `invalidate` option: `'auto'` re-runs the active page's loader;
 * an array calls `.invalidate()` on each `LoaderRef` (and re-runs the active
 * loader if it is in the list); `false`/undefined does nothing. */
export type InvalidateInput =
  | 'auto'
  | false
  | ReadonlyArray<LoaderRef<unknown>>;

/**
 * Reads the enclosing `ReloadContext` + `ActiveLoaderIdContext` and returns a
 * stable apply function shared by `useAction` and `<Form>`. Must be called at
 * the top level of a component/hook (it uses `useContext`).
 */
export function useInvalidate(): (
  invalidate: InvalidateInput | undefined
) => void {
  const reloadCtx = useContext(ReloadContext);
  const activeLoaderId = useContext(ActiveLoaderIdContext);
  return useCallback(
    (invalidate) => {
      if (invalidate === 'auto') {
        reloadCtx?.reload();
      } else if (Array.isArray(invalidate)) {
        let invalidatedActive = false;
        for (const ref of invalidate) {
          ref.invalidate();
          if (activeLoaderId && ref.__id === activeLoaderId) {
            invalidatedActive = true;
          }
        }
        // If the user's list includes the active page's loader, re-run it so
        // the visible <Loader> picks up fresh data. Other refs just clear their
        // caches; those pages refetch on their next mount.
        if (invalidatedActive) {
          reloadCtx?.reload();
        }
      }
    },
    [reloadCtx, activeLoaderId]
  );
}
