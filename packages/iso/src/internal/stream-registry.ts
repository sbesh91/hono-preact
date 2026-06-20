/**
 * The streaming wire event shape: the CONSUMER half of the producer/consumer
 * contract. The PRODUCER half is the bootstrap + per-chunk script builders in
 * `@hono-preact/server`'s `stream-pump.ts`. They are exported (here and via
 * `internal.ts`) so `stream-wire-contract.test.ts` can assert the events the
 * bootstrap emits `satisfies StreamEvent`, failing the build on a field rename
 * that would otherwise desync the two halves silently.
 */
export type StreamEvent =
  | { type: 'push'; loaderId: string; value: unknown }
  | { type: 'end'; loaderId: string }
  | {
      type: 'error';
      loaderId: string;
      error: { message: string; name: string };
    };

type Subscriber = {
  push: (value: unknown) => void;
  end: () => void;
  error: (err: Error) => void;
};

type StreamRegistry = {
  push: (loaderId: string, value: unknown) => void;
  end: (loaderId: string) => void;
  error: (loaderId: string, error: { message: string; name: string }) => void;
  /**
   * Pre-hydration buffer. The SSR inline bootstrap script populates this
   * before the client bundle loads. After `installStreamRegistry()` runs,
   * the field continues to back per-loader buffering of events whose
   * subscriber hasn't mounted yet (the common case during streaming SSR).
   */
  queue?: StreamEvent[];
  /**
   * Set by the SSR bootstrap when the queue hit its cap before the client
   * bundle loaded (events were then dropped). `installStreamRegistry` reads it
   * to warn. Declared here so the read needs no cast.
   */
  capped?: boolean;
};

declare global {
  interface Window {
    __HP_STREAM__?: StreamRegistry;
  }
}

// One subscriber per loaderId. `loaderId` is a `useId()` (see loader.tsx),
// which is unique per mounted loader element and stable across the prerender +
// hydrate passes, so each id is subscribed exactly once. Two live subscribers
// for one id would mean two mounts collided on a useId (a bug), not a supported
// fan-out; `subscribeToLoaderStream` dev-warns rather than silently dropping
// the first. Keeping the Map single-valued matches that invariant.
const subscribers = new Map<string, Subscriber>();
const buffered = new Map<string, StreamEvent[]>();

function dispatchOrBuffer(ev: StreamEvent): void {
  const sub = subscribers.get(ev.loaderId);
  if (sub) {
    dispatch(ev, sub);
  } else {
    let bucket = buffered.get(ev.loaderId);
    if (!bucket) {
      bucket = [];
      buffered.set(ev.loaderId, bucket);
    }
    bucket.push(ev);
  }
}

function dispatch(ev: StreamEvent, sub: Subscriber): void {
  if (ev.type === 'push') sub.push(ev.value);
  else if (ev.type === 'end') sub.end();
  else if (ev.type === 'error') {
    const err = new Error(ev.error.message);
    err.name = ev.error.name;
    sub.error(err);
  }
}

/**
 * Subscribe a loader mount to events for its loader id. Returns an
 * unsubscribe function. Drains any buffered events for this id via a
 * microtask so it is safe to call during a render pass: the current
 * render commits first, then the drain fires setState-y callbacks and
 * Preact re-renders normally.
 */
export function subscribeToLoaderStream(
  loaderId: string,
  sub: Subscriber
): () => void {
  if (subscribers.has(loaderId)) {
    // A duplicate id is a render-once violation (see the `subscribers` Map
    // note): the new mount wins, the prior subscriber stops receiving events
    // and its unsubscribe becomes a no-op. Surface it so the collision is
    // debuggable rather than silently lossy.
    console.warn(
      `[hono-preact] a streaming loader was subscribed twice for id "${loaderId}". ` +
        'Each loader mount has a unique id, so this indicates two mounts collided; ' +
        'the earlier subscriber will stop receiving stream events.'
    );
  }
  subscribers.set(loaderId, sub);

  const bucket = buffered.get(loaderId);
  if (bucket && bucket.length > 0) {
    buffered.delete(loaderId);
    // Defer to a microtask so this is safe to call during a render: the
    // current render commits, then the drain fires setState-y callbacks
    // and Preact re-renders normally.
    queueMicrotask(() => {
      // The subscriber may have unmounted between subscribe and the
      // microtask firing; skip the drain in that case.
      if (subscribers.get(loaderId) !== sub) return;
      for (const ev of bucket) dispatch(ev, sub);
    });
  }

  return () => {
    if (subscribers.get(loaderId) === sub) subscribers.delete(loaderId);
  };
}

/**
 * Install the live dispatcher on `window.__HP_STREAM__`. Any events that
 * were buffered by the SSR inline bootstrap (in `window.__HP_STREAM__.queue`)
 * are routed through `dispatchOrBuffer`, which either delivers them to an
 * already-registered subscriber or holds them until one registers.
 */
export function installStreamRegistry(): void {
  if (typeof window === 'undefined') return;
  const existing = window.__HP_STREAM__;
  const initialQueue = existing?.queue ?? [];
  const wasCapped = existing?.capped === true;

  window.__HP_STREAM__ = {
    push(loaderId: string, value: unknown) {
      dispatchOrBuffer({ type: 'push', loaderId, value });
    },
    end(loaderId: string) {
      dispatchOrBuffer({ type: 'end', loaderId });
    },
    error(loaderId: string, error: { message: string; name: string }) {
      dispatchOrBuffer({ type: 'error', loaderId, error });
    },
  };

  for (const ev of initialQueue) dispatchOrBuffer(ev);

  if (wasCapped) {
    // The SSR-emitted bootstrap dropped events because the buffer hit its
    // cap before this function ran. Surface to the dev console so a slow
    // bundle-load / blocked CDN scenario is debuggable, not just silently
    // lossy on the client.
    console.warn(
      '[hono-preact] streaming bootstrap buffer was capped before the client ' +
        'bundle loaded — some streaming-loader events were dropped. Likely ' +
        'cause: slow or blocked client bundle load.'
    );
  }
}

/**
 * Test-only: clear all buffers and subscribers. Not exposed via internal.ts.
 */
export function __resetStreamRegistryForTests(): void {
  subscribers.clear();
  buffered.clear();
}
