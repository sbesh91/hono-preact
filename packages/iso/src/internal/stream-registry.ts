type StreamEvent =
  | { type: 'push'; loaderId: string; value: unknown }
  | { type: 'end'; loaderId: string }
  | { type: 'error'; loaderId: string; error: { message: string; name: string } };

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
};

declare global {
  interface Window {
    __HP_STREAM__?: StreamRegistry;
  }
}

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
 * unsubscribe function. Drains any buffered events for this id
 * immediately, in order.
 */
export function subscribeToLoaderStream(
  loaderId: string,
  sub: Subscriber
): () => void {
  subscribers.set(loaderId, sub);

  const bucket = buffered.get(loaderId);
  if (bucket) {
    buffered.delete(loaderId);
    for (const ev of bucket) dispatch(ev, sub);
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
}

/**
 * Test-only: clear all buffers and subscribers. Not exposed via internal.ts.
 */
export function __resetStreamRegistryForTests(): void {
  subscribers.clear();
  buffered.clear();
}
