// @hono-preact/iso/internal -- escape hatch for advanced consumers.
//
// These primitives compose the default <Page> pipeline. They're kept
// behind a subpath so the front door (@hono-preact/iso) stays small.
// Use them when definePage bindings or <Page> props don't express
// what you need (e.g. distinct fallbacks for guards vs. loader, custom
// pipeline ordering, advanced SSR work).
//
// The contract here is intentionally less stable than the package's main
// surface. Internal symbols may change shape between minor versions.

export { Loader } from './internal/loader.js';
export { Envelope } from './internal/envelope.js';
export { RouteBoundary } from './internal/route-boundary.js';
export { Guards, GuardGate, useGuardResult } from './internal/guards.js';
export { OptimisticOverlay } from './internal/optimistic-overlay.js';

export {
  LoaderIdContext,
  LoaderDataContext,
  GuardResultContext,
} from './internal/contexts.js';
export { ReloadContext } from './reload-context.js';

export { getPreloadedData, deletePreloadedData } from './internal/preload.js';
export { runRequestScope } from './cache.js';
export { default as wrapPromise } from './internal/wrap-promise.js';
export { runGuards } from './guard.js';

export {
  __dispatchRouteChange,
  __subscribeRouteChange,
  __enableViewTransitions,
} from './internal/route-change.js';

export {
  installStreamRegistry,
  subscribeToLoaderStream,
} from './internal/stream-registry.js';
