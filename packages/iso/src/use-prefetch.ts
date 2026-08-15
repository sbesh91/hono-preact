import { useCallback, useContext } from 'preact/hooks';
import type { AnyLoaderRef } from './define-loader.js';
import { RouteManifestContext } from './internal/route-manifest.js';
import { prefetchFor } from './prefetch-for.js';

/**
 * Returns a callback that prefetches `refs` for the route `href` points at.
 * Bind it to any intent event (hover, focus, touch, pointerenter, an
 * IntersectionObserver). The route's params are resolved from the manifest, so
 * callers do not repeat the route pattern. A warm cache makes repeat calls a
 * no-op (see `prefetch`).
 *
 * Statically imports the prefetch machinery, which is correct here: reaching
 * for this hook IS opting into prefetching, so its cost belongs to the app that
 * called it. `<NavLink>`'s `prefetch` prop cannot use this hook (a component
 * that renders without the prop must not pay those bytes), so it calls
 * `prefetchFor` through a dynamic import instead.
 */
export function usePrefetch(
  href: string,
  refs: AnyLoaderRef | ReadonlyArray<AnyLoaderRef>
): () => void {
  const routes = useContext(RouteManifestContext);
  return useCallback(
    () => prefetchFor(href, refs, routes),
    [href, refs, routes]
  );
}
