import { describe, it, expect } from 'vitest';
import { readSSE } from '../sse-decoder.js';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe('readSSE', () => {
  it('parses single data events', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":1}\n\ndata: {"a":2}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '{"a":2}' },
    ]);
  });

  it('parses named events', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('event: result\ndata: {"ok":true}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'result', data: '{"ok":true}' }]);
  });

  it('ignores comment lines', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf(': keepalive\n\ndata: {"a":1}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('handles chunk boundaries in the middle of an event', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":', '1}\n\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('handles CRLF line endings', async () => {
    const events: { event: string; data: string }[] = [];
    for await (const ev of readSSE(streamOf('data: {"a":1}\r\n\r\n'))) {
      events.push(ev);
    }
    expect(events).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });
});
