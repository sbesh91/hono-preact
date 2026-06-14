// @hono-preact/iso/internal: escape-hatch tier for advanced consumers.
//
// These primitives compose the default <Page> pipeline by hand: custom
// middleware composition, distinct fallbacks for the middleware host vs.
// the loader, advanced SSR work. Reach for them knowingly and expect to
// read the source.
//
// STABILITY: intentionally less stable than the package's main surface.
// Symbols may be renamed, retyped, or removed in any non-major release.
// Pin a framework version if your code reaches in here.
//
// (Framework plumbing the generated code and our vite plugins depend on
// lives on the separate `/internal/runtime` door, not here.)

export { Loader } from './internal/loader.js';
export { Envelope } from './internal/envelope.js';
export { RouteBoundary } from './internal/route-boundary.js';
export { OptimisticOverlay } from './internal/optimistic-overlay.js';

export {
  serializeActionOutcome,
  decodeActionResponse,
  RENDER_PAGE_SCOPE_MESSAGE,
  type ActionEnvelope,
  type ActionResolution,
  type SerializedEnvelope,
  type DecodedEnvelope,
} from './internal/action-envelope.js';

export { LoaderIdContext, LoaderDataContext } from './internal/contexts.js';
export { ReloadContext } from './reload-context.js';
export {
  RouteLocationsContext,
  RouteLocationsProvider,
} from './internal/route-locations.js';

export { getPreloadedData, deletePreloadedData } from './internal/preload.js';
export {
  runRequestScope,
  getRequestStore,
  captureRequestScope,
  getActionResultSlot,
  setActionResultSlot,
  type ActionResultSlot,
} from './cache.js';
export { default as wrapPromise } from './internal/wrap-promise.js';
export { HonoRequestContext } from './internal/contexts.js';
export { PageMiddlewareHost } from './internal/page-middleware-host.js';

export { getNavDirection } from './internal/history-shim.js';
export { __subscribePhase, type PhaseName } from './internal/route-change.js';
export {
  ViewTransitionEvent,
  type NavDirection,
  type ViewTransitionReason,
} from './internal/view-transition-event.js';

export {
  renderElement,
  type RenderElementRender,
} from './internal/render-element.js';
export { mergeRefs } from './internal/merge-refs.js';

export { subscribeToLoaderStream } from './internal/stream-registry.js';

export {
  registerServerStreamingLoader,
  takeServerStreamingLoaders,
} from './internal/streaming-ssr.js';
export type { ServerLoaderStream } from './internal/streaming-ssr.js';

export {
  beginSubmit,
  endSubmit,
  isPending,
  subscribe as subscribeFormSubmit,
} from './internal/form-submit-store.js';

export { assignSafeRedirect, isSameOrigin } from './internal/safe-redirect.js';

export {
  setLastActionResult,
  clearLastActionResult,
  getLastActionResult,
  subscribeActionResults,
  type StoredActionResult,
} from './internal/action-result-store.js';

// Middleware dispatcher + observer fanout. Internal-stability subpath.
export {
  dispatchServer,
  dispatchClient,
  type DispatchResult,
} from './internal/middleware-runner.js';
export { partitionUse } from './internal/use-partitioner.js';
export {
  fanStart,
  fanChunk,
  fanEnd,
  fanError,
  fanAbort,
} from './internal/stream-observer-runner.js';

// SSE codec (decoder). The encoder and the SSE wire format are intentionally
// framework-internal (the encoder is package-private in @hono-preact/server);
// readSSE is the one blessed escape-hatch for reading a streaming
// loader/action response as typed events in tests and advanced consumers.
export { readSSE } from './internal/sse-decoder.js';
export type { SSEEvent } from './internal/sse-decoder.js';
