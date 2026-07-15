// @hono-preact/iso/internal/runtime: framework-emitted tier.
//
// Pure plumbing the framework's own code depends on: the installers the
// generated client entry calls, the loader stub the server-only plugin
// emits, and the cross-package wire-contract constants our vite plugins
// import at build time. Users never import this door. It is co-versioned
// with the codegen that emits it and may change in any non-major release.
export { installHistoryShim } from './internal/history-shim.js';
export { installNavTransitionScheduler } from './internal/route-change.js';
export { installStreamRegistry } from './internal/stream-registry.js';
export {
  installPubSubBackend,
  getPubSubBackend,
  __resetPubSubForTesting,
} from './internal/pubsub.js';
export type { PubSubBackend } from './internal/pubsub.js';
// Presence roster plumbing the room runtime (in @hono-preact/server) drives.
// It pairs each registry mutation with a wire broadcast; the registry itself
// is transport-free.
export {
  joinPresence,
  leavePresence,
  updatePresence,
  presenceMembers,
  __resetPresenceForTesting,
} from './internal/presence.js';
export {
  installWebSocketUpgrader,
  getWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
} from './internal/ws-upgrader.js';
export type { WebSocketUpgrader } from './internal/ws-upgrader.js';
// Pluggable realtime connector: the in-worker Node room runtime is the default
// (no connector installed); the Cloudflare adapter installs one to forward an
// allowed room upgrade to a Durable Object. socketsHandler resolves + guards at
// the edge before invoking it, so no unauthorized connection reaches the DO.
export {
  installRealtimeConnector,
  getRealtimeConnector,
  __resetRealtimeConnectorForTesting,
} from './internal/realtime-connector.js';
export type {
  RealtimeConnector,
  RealtimeConnectContext,
  RoomForwardContext,
  SocketForwardContext,
  DenyContext,
} from './internal/realtime-connector.js';
export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';
// Subtree-pattern key construction shared with @hono-preact/server's boot
// validator (route-binding-guard.ts); users spell the pattern as a literal
// '<path>/*' string, so it has no public-barrel story.
export { subtreePatternOf } from './define-routes.js';
// Required-param-slot extraction shared with @hono-preact/server's room-key
// resolver, socket param resolver, and boot congruence check.
// Declared-param-slot extraction (required AND optional/rest) shared with the
// same two resolvers, so they can restrict a resolved params object to the
// pattern's own declared slots and drop anything else.
// isConformingParamSegment is shared with @hono-preact/server's boot binding
// guard, which rejects a route-bound socket/room whose __routeId carries a
// non-conforming ':'-segment (the route-side twin of defineChannel's own
// definition-time check).
// toNullProtoParams/isPresentParamSlot are shared with the same package's
// room-key resolver and socket param resolver, so both build and check their
// untrusted-wire params objects identically (the prototype-chain auth-bypass
// fix: see param-slots.ts's own docs).
// isHazardousColonSegment is shared with the same boot binding guard's
// route-id conformance check, so it and defineChannel's own definition-time
// check can never disagree on which ':'-segment spellings are a real hazard.
// guardReadableParamSlots is shared with the same boot binding guard's
// colocated-unit advisory and its room/channel congruence check: it answers
// "what param could a guard actually read" per preact-iso's own (wider)
// `exec` matcher, so a hyphenated route param is no longer invisible to
// those two detections the way it is to declaredParamSlots.
// emptyParams() returns a FRESH, prototype-less, mutable EMPTY params record
// for every "no params to resolve" call site (see param-slots.ts's own doc):
// the completion of the prototype-chain auth-bypass fix for sites that
// previously fell back to a plain `{}` literal instead of running the
// parsed-params pipeline at all. A fresh object per call, not a shared
// singleton, so a userland-mutable position (the socket `data(ctx, params)`
// edge factory's params argument) stays extensible and no two connections
// alias the same object.
export {
  requiredParamSlots,
  declaredParamSlots,
  guardReadableParamSlots,
  isConformingParamSegment,
  toNullProtoParams,
  isPresentParamSlot,
  isHazardousColonSegment,
  emptyParams,
} from './internal/param-slots.js';
export * from './internal/contract.js';
export {
  validateWithSchema,
  normalizeIssues,
  mapIssuesToFields,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
export { env } from './is-browser.js';
export {
  coerceLoaderLocation,
  coerceActionInput,
  type LooseLoaderFn,
} from './internal/loader-schema.js';
export { collectFormData } from './internal/form-data.js';
