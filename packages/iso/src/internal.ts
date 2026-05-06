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

export { Loader } from './loader.js';
export { Envelope } from './envelope.js';
export { RouteBoundary } from './route-boundary.js';
export { Guards, GuardGate, useGuardResult } from './guards.js';
export { OptimisticOverlay } from './optimistic-overlay.js';

export {
  LoaderIdContext,
  LoaderDataContext,
  GuardResultContext,
} from './contexts.js';
export { ReloadContext } from './reload-context.js';

export { getPreloadedData, deletePreloadedData } from './preload.js';
export { runRequestScope } from './cache.js';
export { default as wrapPromise } from './wrap-promise.js';
export { runGuards } from './guard.js';
