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
  // The backend's onError writes the drop here. A holder (not a bare `let`): a
  // variable written ONLY by the callback is control-flow-narrowed to its
  // initializer in the generator body (TS cannot see the callback run), but a
  // property read is not. `error` is boxed so a falsy error still reads as a drop.
  const drop: { failure: { error: unknown } | null } = { failure: null };

  const unsub = getPubSubBackend().subscribe(
    topic,
    () => {
      pending = true;
      wake?.();
      wake = null;
    },
    (error) => {
      // The backend's subscription dropped (e.g. a CF worker->DO topic socket
      // died). Record it and wake the generator so it throws instead of hanging.
      drop.failure = { error };
      wake?.();
      wake = null;
    }
  );

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
        if (!pending && !drop.failure) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (signal.aborted) break;
        const failure = drop.failure;
        if (failure) {
          // Surface the drop so the live-loader generator errors and the SSE
          // stream terminates (status='error' on the client), honoring the
          // documented live-loader drop contract instead of going silently stale.
          throw failure.error instanceof Error
            ? failure.error
            : new Error('hono-preact: live subscription dropped');
        }
        pending = false;
        yield;
      }
    } finally {
      teardown();
    }
  })();
}
