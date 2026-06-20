import type { Topic } from './define-channel.js';
import { getPubSubBackend } from './internal/pubsub.js';

// A signal channel (Topic<void>) publishes with no message; a payload channel
// requires its message. Mirrors define-channel's KeyArgs conditional-rest shape.
type PublishArgs<P> = [P] extends [void] ? [] : [message: P];

/**
 * Publish to a typed channel topic. Call from a server action (or a server
 * agent) after a mutation; every live loader subscribed to the topic re-runs
 * its `load` and pushes fresh data.
 *
 *   publish(boardChannel.key({ projectId }), { taskId, to });
 *   publish(pingChannel.key());            // signal channel
 */
export function publish<P>(topic: Topic<P>, ...args: PublishArgs<P>): void {
  getPubSubBackend().publish(topic, args[0]);
}
