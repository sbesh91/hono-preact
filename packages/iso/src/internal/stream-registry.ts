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
  /** Pre-hydration buffer; the SSR inline bootstrap pushes events here. */
  queue?: StreamEvent[];
};

declare global {
  interface Window {
    __HP_STREAM__?: StreamRegistry;
  }
}

const subscribers = new Map<string, Subscriber>();

/**
 * Subscribe a loader mount to events for its loader id. Returns an
 * unsubscribe function. If a buffered event exists for this id in the
 * pre-hydration queue, it is dispatched immediately on subscribe.
 */
export function subscribeToLoaderStream(
  loaderId: string,
  sub: Subscriber
): () => void {
  subscribers.set(loaderId, sub);

  // Drain any buffered events for this id from the pre-hydration queue.
  if (typeof window !== 'undefined') {
    const reg = window.__HP_STREAM__;
    if (reg?.queue) {
      const drained: StreamEvent[] = [];
      for (const ev of reg.queue) {
        if (ev.loaderId === loaderId) dispatch(ev);
        else drained.push(ev);
      }
      reg.queue = drained;
    }
  }

  return () => {
    if (subscribers.get(loaderId) === sub) subscribers.delete(loaderId);
  };
}

function dispatch(ev: StreamEvent): void {
  const sub = subscribers.get(ev.loaderId);
  if (!sub) return;
  if (ev.type === 'push') sub.push(ev.value);
  else if (ev.type === 'end') sub.end();
  else if (ev.type === 'error') {
    const err = new Error(ev.error.message);
    err.name = ev.error.name;
    sub.error(err);
  }
}

/**
 * Install the dispatcher on `window.__HP_STREAM__`. If the SSR inline
 * bootstrap already populated a queue, drain it. After installation,
 * subsequent script-tag pushes from the still-streaming response body
 * route directly to live subscriptions.
 */
export function installStreamRegistry(): void {
  if (typeof window === 'undefined') return;
  const existing = window.__HP_STREAM__;
  const queue = existing?.queue ?? [];

  window.__HP_STREAM__ = {
    push(loaderId: string, value: unknown) {
      dispatch({ type: 'push', loaderId, value });
    },
    end(loaderId: string) {
      dispatch({ type: 'end', loaderId });
    },
    error(loaderId: string, error: { message: string; name: string }) {
      dispatch({ type: 'error', loaderId, error });
    },
  };

  // Drain any pre-hydration events.
  for (const ev of queue) dispatch(ev);
}
