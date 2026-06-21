import { describe, it, expect, afterEach } from 'vitest';
import { publish } from '../pubsub.js';
import { defineChannel } from '../define-channel.js';
import { inProcessBackend, installPubSubBackend } from '../internal/pubsub.js';

afterEach(() => installPubSubBackend(inProcessBackend));

describe('publish', () => {
  it('delivers a payload to a subscriber of the channel topic', () => {
    const ch = defineChannel('board/:projectId')<{ n: number }>();
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('board/p1', (m) => got.push(m));
    publish(ch.key({ projectId: 'p1' }), { n: 7 });
    off();
    expect(got).toEqual([{ n: 7 }]);
  });

  it('a signal (void) channel publishes with no message argument', () => {
    const ping = defineChannel('ping')();
    const got: unknown[] = [];
    const off = inProcessBackend.subscribe('ping', (m) => got.push(m));
    publish(ping.key());
    off();
    expect(got).toEqual([undefined]);
  });
});
