import { useCallback, useContext } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';
import { ActiveLoaderIdContext } from './internal/contexts.js';
import type { AnyLoaderRef } from './define-loader.js';

/**
 * How to update loader caches after an action commits. Two orthogonal
 * decisions rather than one overloaded value: which caches to clear, and
 * whether to re-run the active page's loader.
 */
export type InvalidateInput = {
  /** Loader caches to clear. Each ref's `.invalidate()` is called. */
  clear?: ReadonlyArray<AnyLoaderRef>;
  /**
   * Re-run the active page's loader. Defaults to true when the active loader
   * appears in `clear`, false otherwise. Set explicitly to override.
   */
  refetchActive?: boolean;
};

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
      if (!invalidate) return;
      let clearedActive = false;
      for (const ref of invalidate.clear ?? []) {
        ref.invalidate();
        if (activeLoaderId && ref.__id === activeLoaderId) clearedActive = true;
      }
      // Clearing the active page's loader re-runs it so the visible <Loader>
      // picks up fresh data. Other refs just clear their caches; those pages
      // refetch on their next mount. An explicit `refetchActive` overrides.
      const refetch = invalidate.refetchActive ?? clearedActive;
      if (refetch) reloadCtx?.reload();
    },
    [reloadCtx, activeLoaderId]
  );
}
