// Server-side topic pub/sub. The in-process backend is the default (used on
// Node, where publisher and subscriber share one process); a different backend
// (e.g. a Cloudflare Durable Object) is installed at runtime via
// installPubSubBackend. The Vite adapter is build-time only and does not supply
// this; it is a runtime seam.

/** A topic message bus. `subscribe` returns an unsubscribe function. */
export interface PubSubBackend {
  publish(topic: string, message: unknown): void;
  subscribe(topic: string, onMessage: (message: unknown) => void): () => void;
}

// Process-global registry so the bus survives HMR and multiple module
// evaluations, mirroring define-loader.ts's SHARED_CACHES_KEY accessor.
const REGISTRY_KEY = Symbol.for('@hono-preact/pubsub-inprocess');

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, Set<(message: unknown) => void>>;
};

function registry(): Map<string, Set<(message: unknown) => void>> {
  const g = globalThis as GlobalWithRegistry;
  return (g[REGISTRY_KEY] ??= new Map());
}

export const inProcessBackend: PubSubBackend = {
  publish(topic, message) {
    const subs = registry().get(topic);
    if (!subs) return;
    // Copy before iterating so an unsubscribe during dispatch is safe; isolate
    // each subscriber so one throwing listener does not starve the rest.
    for (const cb of [...subs]) {
      try {
        cb(message);
      } catch {
        // ignore a misbehaving subscriber
      }
    }
  },
  subscribe(topic, onMessage) {
    const reg = registry();
    let set = reg.get(topic);
    if (!set) {
      set = new Set();
      reg.set(topic, set);
    }
    set.add(onMessage);
    return () => {
      set.delete(onMessage);
      if (set.size === 0) reg.delete(topic);
    };
  },
};

let current: PubSubBackend = inProcessBackend;

/** Swap the active pub/sub backend (e.g. a Durable-Object backend on CF). */
export function installPubSubBackend(backend: PubSubBackend): void {
  current = backend;
}

/** The active backend. Internal helpers (publish, subscribeTopic) delegate here. */
export function getPubSubBackend(): PubSubBackend {
  return current;
}
