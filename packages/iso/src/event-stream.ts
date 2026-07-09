import type { Topic } from './define-channel.js';
import type { Serialize } from './internal/serialize.js';
import { getPubSubBackend } from './internal/pubsub.js';

/**
 * Subscribe to a typed channel topic as an async generator of its published
 * payloads. The fine-grained sibling of `liveStream`: where `liveStream`
 * treats a publish as a "something changed, re-run load" wake and discards
 * the message, `eventStream` delivers every published payload, in order, to a
 * streaming loader that yields events (activity feeds, tickers, notification
 * bars). It rides the same pub/sub backend as `publish()`, so on Cloudflare
 * the events fan out across isolates through the realtime Durable Object.
 *
 * ```ts
 * const activityChannel = defineChannel('activity')<ActivityEvent>();
 *
 * export const serverLoaders = {
 *   activity: defineLoader(
 *     async function* ({ signal }) {
 *       for await (const e of eventStream(activityChannel.key(), signal)) {
 *         yield e;
 *       }
 *     },
 *     { live: true }
 *   ),
 * };
 * ```
 *
 * The yield type is `Serialize<P>` (the JSON wire shape): on Cloudflare the
 * payload crosses a Durable Object socket as JSON, so a `Date` published on
 * one isolate arrives as its ISO string on another. Publish JSON-shaped
 * payloads and the two are identical.
 *
 * The subscription is registered eagerly (at call time), so a publish landing
 * before the first pull is buffered, not missed. Payloads queue FIFO while
 * the consumer is busy (unbounded; a streaming loader drains continuously).
 * Teardown is idempotent and wired to BOTH the abort listener and the
 * generator's `finally`, so the subscription is removed when `signal` aborts
 * even if the iterable was never pulled. A backend-reported subscription drop
 * (e.g. a CF worker->DO topic socket dying) throws out of the generator so
 * the stream terminates instead of going silently stale.
 */
export function eventStream<P>(
  topic: Topic<P>,
  signal: AbortSignal
): AsyncGenerator<Serialize<P>, void, unknown> {
  const queue: Serialize<P>[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  // Boxed so a falsy error still reads as a drop; see subscribe-topic.ts
  // (this file's coalescing sibling) for the narrowing rationale.
  const drop: { failure: { error: unknown } | null } = { failure: null };

  const unsub = getPubSubBackend().subscribe(
    topic,
    (message) => {
      // The payload crossed the pub/sub backend as `unknown` (on Cloudflare
      // it is a JSON round-trip over the Durable Object socket). `Topic<P>`
      // binds the payload type at the publish site, so this is the sanctioned
      // untrusted-wire boundary where the type re-enters.
      queue.push(message as Serialize<P>);
      wake?.();
      wake = null;
    },
    (error) => {
      // The backend's subscription dropped. Record it and wake the generator
      // so it throws instead of hanging.
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
        if (queue.length === 0 && !drop.failure) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (signal.aborted) break;
        while (queue.length > 0 && !signal.aborted) {
          // Length-checked and single-consumer, so shift() is defined.
          yield queue.shift()!;
        }
        if (signal.aborted) break;
        // Drain the queue (above) before checking the failure: a payload that
        // arrived in the same wake window as a drop must still be delivered
        // before the generator throws, honoring the every-payload-in-order
        // contract at the failure edge.
        const failure = drop.failure;
        if (failure) {
          throw failure.error instanceof Error
            ? failure.error
            : new Error('hono-preact: event stream subscription dropped');
        }
      }
    } finally {
      teardown();
    }
  })();
}
