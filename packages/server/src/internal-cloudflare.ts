// @hono-preact/server/internal/cloudflare: framework-emitted, Cloudflare-only tier.
//
// This door is SEPARATE from `@hono-preact/server/internal/runtime` on purpose:
// `realtime-do.ts` imports `cloudflare:workers` (the Durable Object base class),
// a module that resolves ONLY in workerd. Re-exporting it through the shared
// runtime door would make the Node generated server entry (which imports that
// door) crash at boot. The Cloudflare adapter's generated worker entry imports
// THIS door instead; the Node entry never touches it.
//
// DO NOT IMPORT FROM USER CODE; this door is undocumented and may change in any
// non-major release in lockstep with the codegen that emits it.
export {
  HonoPreactRealtimeDO,
  makeCfForwardConnector,
  makeDOConnState,
} from './cf/realtime-do.js';
export {
  installRoomRegistry,
  getRoomRegistry,
  __resetRoomRegistryForTesting,
} from './cf/room-registry.js';
export { buildRoomRegistry } from './rooms-handler.js';
export {
  installSocketRegistry,
  getSocketRegistry,
  __resetSocketRegistryForTesting,
} from './cf/socket-registry.js';
export { buildSocketRegistry } from './sockets-handler.js';
export {
  makeCfPubSubBackend,
  runWithRealtimeRuntime,
  getRealtimeRuntime,
} from './cf/cf-pubsub.js';
export { makeAssetsPreloadReader } from './cf/preload-reader.js';
export { makeCfWebSocketUpgrader } from './cf/ws-upgrader-cf.js';
