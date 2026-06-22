import type { RoomDef } from '@hono-preact/iso/internal';

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;

/** A resolver that produces (or has already produced) the room registry map. */
type RoomRegistryGetter = () =>
  | Promise<Map<string, AnyRoomDef>>
  | Map<string, AnyRoomDef>;

// The room-registry install seam for the Cloudflare Durable Object runtime.
//
// On Node the room runtime runs in the worker process, where the route server
// modules are already loaded, so the registry is built inline (rooms-handler's
// buildRoomRegistry). On Cloudflare the room runtime runs INSIDE the Durable
// Object, which never sees the worker's request-time wiring. The generated CF
// worker entry (Task 6's wrapEntry) installs the registry at module top level:
//
//   installRoomRegistry(() => buildRoomRegistry(serverImports));
//
// The DO's getDef resolves the installed getter (once, then caches the Map) and
// looks up `${moduleKey}::${name}`.
//
// CROSS-ISOLATE RISK (Task 8 confirmation item): this assumes the DO isolate
// evaluates the worker-entry module's top level (where installRoomRegistry
// runs). If workerd evaluates the DO class in an isolate that does NOT run the
// entry module's top-level install, getRoomRegistry() will return undefined in
// the DO and the fallback is for the generated entry to provide serverImports
// to the DO via a module the DO imports directly. The Task 8 workerd
// integration test validates this end to end. Mirrors installPubSubBackend.

let current: RoomRegistryGetter | undefined;

/**
 * Install the room-registry getter the Durable Object resolves. Called once at
 * module top level by the generated Cloudflare worker entry.
 */
export function installRoomRegistry(getter: RoomRegistryGetter): void {
  current = getter;
}

/**
 * The installed room-registry getter, or `undefined` if none was installed
 * (which on Cloudflare is a misconfiguration: the generated entry must install
 * one). The DO calls this and caches the resolved Map.
 */
export function getRoomRegistry(): RoomRegistryGetter | undefined {
  return current;
}

/** Test-only reset. */
export function __resetRoomRegistryForTesting(): void {
  current = undefined;
}
