// @hono-preact/iso/internal -- escape hatch for advanced consumers.
//
// These primitives compose the default <Page> pipeline. They're kept
// behind a subpath so the front door (@hono-preact/iso) stays small.
// Use them when definePage bindings or <Page> props don't express
// what you need (e.g. custom middleware composition, distinct fallbacks
// for the middleware host vs. the loader, advanced SSR work).
//
// STABILITY: this subpath is intentionally less stable than the package's
// main surface. Symbols may be renamed, retyped, or removed in any
// non-major release. Pin a specific framework version if your code reaches
// in here.
//
// The file is split into two sections:
//
//   1. ADVANCED USER ESCAPE HATCHES — primitives users may reasonably
//      compose by hand when `definePage` bindings aren't enough. Reach for
//      these knowingly; expect to read the source.
//
//   2. FRAMEWORK-EMITTED (DO NOT IMPORT FROM USER CODE) — symbols the
//      framework's own Vite plugins emit `import` statements for, then
//      reference in code they generate. They're exported here only because
//      the emitted code needs a real import target. Importing them
//      yourself bypasses everything the public API does and your code
//      will break at a non-major upgrade.

// ─── Section 1: advanced user escape hatches ─────────────────────────────

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

export {
  installNavTransitionScheduler,
  __subscribeRouteChange,
} from './internal/route-change.js';

export {
  installHistoryShim,
  getNavDirection,
} from './internal/history-shim.js';
export { __subscribePhase, type PhaseName } from './internal/route-change.js';
export {
  ViewTransitionEvent,
  type NavDirection,
  type ViewTransitionReason,
} from './internal/view-transition-event.js';

export { useRender, type UseRenderRender } from './internal/use-render.js';
export { mergeRefs } from './internal/merge-refs.js';

export {
  installStreamRegistry,
  subscribeToLoaderStream,
} from './internal/stream-registry.js';

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

// Cross-package wire-contract constants (paths, field names, generated ids).
export {
  LOADERS_RPC_PATH,
  CLIENT_ENTRY_FILE,
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_ID,
  VIRTUAL_CLIENT_DEV_URL,
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from './internal/contract.js';

// ─── Section 2: framework-emitted (DO NOT IMPORT FROM USER CODE) ─────────
// The `__$..._hpiso` naming makes the convention visible at every grep:
// these symbols are referenced by code the framework's Vite plugins emit
// (serverOnlyPlugin's loader stubs, guardStripPlugin's no-op replacement).
// User code that imports them couples to plugin internals.

export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';

// SSE decoder; useful in tests and advanced consumers that need to read
// a streaming loader/action response as a sequence of typed SSE events.
export { readSSE } from './internal/sse-decoder.js';
export type { SSEEvent } from './internal/sse-decoder.js';
