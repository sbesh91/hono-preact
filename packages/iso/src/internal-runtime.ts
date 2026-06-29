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
