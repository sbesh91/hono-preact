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
 * `invalidate` used to accept `'auto'`, `false`, and a bare array of loader
 * refs. Those spellings are gone, and TypeScript rejects them, but an untyped
 * JavaScript caller still passing one would fall through this hook silently:
 * `.clear` and `.refetchActive` are both absent on a string/array/boolean, so
 * nothing clears and nothing reloads, leaving a stale UI with no error to
 * debug against. Throw instead, so the removed spelling is impossible to miss.
 *
 * Dev/SSR-only (the "#338 gate"): `typeof import.meta.env === 'undefined'`
 * first so the diagnostic survives in a non-Vite consumer (plain Node, where
 * `import.meta.env` is never injected), then `.SSR`/`.DEV`. A production
 * client build folds the whole block away, so this costs zero shipped bytes.
 */
function assertInvalidateShape(invalidate: unknown): void {
  if (
    typeof import.meta.env === 'undefined' ||
    import.meta.env.SSR ||
    import.meta.env.DEV
  ) {
    const legacy =
      typeof invalidate === 'string'
        ? `'${invalidate}'`
        : Array.isArray(invalidate)
          ? 'an array of loader refs'
          : invalidate === false
            ? 'false'
            : null;
    if (legacy !== null) {
      throw new Error(
        `hono-preact: invalidate was given ${legacy}, which is no longer a ` +
          `supported shape. Pass an object instead: ` +
          `{ clear: [loaderRef], refetchActive: true }. ` +
          `'auto' is now { refetchActive: true }, false is now omitting ` +
          `invalidate entirely (or { refetchActive: false }), and a bare ` +
          `array of refs is now { clear: [...] }.`
      );
    }
  }
}

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
      assertInvalidateShape(invalidate);
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
