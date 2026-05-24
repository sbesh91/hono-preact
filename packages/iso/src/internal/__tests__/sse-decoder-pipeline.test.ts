import { describe, it, expect } from 'vitest';
import { readSSE } from '../sse-decoder.js';

function asStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Split in odd places to exercise multi-chunk buffering.
      controller.enqueue(bytes.slice(0, 5));
      controller.enqueue(bytes.slice(5, 17));
      controller.enqueue(bytes.slice(17));
      controller.close();
    },
  });
}

describe('readSSE', () => {
  it('parses event-tagged data frames split across multiple TCP-sized chunks', async () => {
    const input =
      'data: "first"\n\n' +
      'event: result\ndata: "final"\n\n' +
      'event: timeout\ndata: {"timeoutMs":75}\n\n';

    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(asStream(input))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'message', data: '"first"' },
      { event: 'result', data: '"final"' },
      { event: 'timeout', data: '{"timeoutMs":75}' },
    ]);
  });

  it('ignores keepalive comments and resets event after blank line', async () => {
    const input = ': keepalive\n' + 'event: tick\ndata: 1\n\n' + 'data: 2\n\n';
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(asStream(input))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'tick', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });
});
