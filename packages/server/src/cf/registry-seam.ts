/** A resolver that produces (or has already produced) a registry map. */
export type RegistryGetter<T> = () => Promise<Map<string, T>> | Map<string, T>;

/** The install/get/reset trio for one cross-isolate registry seam. */
export interface RegistrySeam<T> {
  install(getter: RegistryGetter<T>): void;
  get(): RegistryGetter<T> | undefined;
  reset(): void;
}

// A registry install seam for the Cloudflare Durable Object runtime. On Node a
// realtime def's runtime runs in the worker, where the route server modules are
// already loaded, so the registry is built inline. On Cloudflare the runtime
// runs INSIDE the Durable Object, which never sees the worker's request-time
// wiring, so the generated CF worker entry installs the getter at module top
// level and the DO resolves (and caches) it.
//
// CROSS-ISOLATE RISK: this assumes the DO isolate evaluates the worker-entry
// module's top level (where install runs). If workerd evaluates the DO class in
// an isolate that does NOT run that install, get() returns undefined in the DO;
// the workerd integration tests (cf-room / cf-socket) validate the install end
// to end. Mirrors installPubSubBackend.
//
// Each call returns an INDEPENDENT seam (its own module-level singleton), so the
// room and socket registries never share state.
export function makeRegistrySeam<T>(): RegistrySeam<T> {
  let current: RegistryGetter<T> | undefined;
  return {
    install(getter) {
      current = getter;
    },
    get() {
      return current;
    },
    reset() {
      current = undefined;
    },
  };
}
