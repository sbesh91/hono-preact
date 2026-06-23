import type { SocketDef } from '@hono-preact/iso/internal';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

/** A resolver that produces (or has already produced) the socket registry map. */
type SocketRegistryGetter = () =>
  | Promise<Map<string, AnySocketDef>>
  | Map<string, AnySocketDef>;

// The socket-registry install seam for the Cloudflare Durable Object runtime.
//
// On Node a plain socket runs in the worker, where the route server modules are
// already loaded, so the registry is built inline (sockets-handler's
// buildSocketRegistry). On Cloudflare a plain socket runs INSIDE a Durable
// Object, which never sees the worker's request-time wiring. The generated CF
// worker entry installs the getter at module top level:
//
//   installSocketRegistry(() => buildSocketRegistry(serverImports));
//
// The DO's getSocketDef resolves the installed getter (once, then caches the
// Map) and looks up `${moduleKey}::${name}`. Mirrors installRoomRegistry.
//
// CROSS-ISOLATE RISK: this assumes the DO isolate evaluates the worker-entry
// module's top level (where installSocketRegistry runs). If workerd evaluates
// the DO class in an isolate that does NOT run the entry module's top-level
// install, getSocketRegistry() will return undefined in the DO and the fallback
// is for the generated entry to provide serverImports to the DO via a module the
// DO imports directly. The Task 8 workerd integration test validates this end to
// end. Mirrors installRoomRegistry.

let current: SocketRegistryGetter | undefined;

/**
 * Install the socket-registry getter the Durable Object resolves. Called once
 * at module top level by the generated Cloudflare worker entry.
 */
export function installSocketRegistry(getter: SocketRegistryGetter): void {
  current = getter;
}

/**
 * The installed socket-registry getter, or `undefined` if none was installed
 * (on Cloudflare that is a misconfiguration). The DO calls this and caches the
 * resolved Map.
 */
export function getSocketRegistry(): SocketRegistryGetter | undefined {
  return current;
}

/** Test-only reset. */
export function __resetSocketRegistryForTesting(): void {
  current = undefined;
}
