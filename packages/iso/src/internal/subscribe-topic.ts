import { getPubSubBackend } from './pubsub.js';

/**
 * Bridge a topic subscription into a coalescing async iterable for a live
 * loader's generator: each `yield` is a "something changed, re-run load" wake.
 * A burst of publishes that arrives between pulls collapses to a single wake
 * (coarse re-run). The subscription is registered eagerly (at call time) so a
 * publish that lands before the first pull is not missed.
 *
 * Teardown is idempotent and wired to BOTH the abort listener and the
 * generator's `finally`, so the subscription is removed when `signal` aborts
 * even if the iterable was never pulled.
 */
export function subscribeTopic(
  topic: string,
  signal: AbortSignal
): AsyncGenerator<void, void, unknown> {
  let pending = false;
  let wake: (() => void) | null = null;
  let closed = false;

  const unsub = getPubSubBackend().subscribe(topic, () => {
    pending = true;
    wake?.();
    wake = null;
  });

  const teardown = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', onAbort);
    unsub();
  };
  function onAbort() {
    teardown();
    wake?.();
    wake = null;
  }

  signal.addEventListener('abort', onAbort);
  // Aborted before we attached: tear down immediately.
  if (signal.aborted) teardown();

  return (async function* () {
    try {
      while (!signal.aborted) {
        if (!pending) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (signal.aborted) break;
        pending = false;
        yield;
      }
    } finally {
      teardown();
    }
  })();
}
