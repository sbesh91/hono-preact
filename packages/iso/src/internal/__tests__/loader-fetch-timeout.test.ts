// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLoaderData } from '../loader-fetch.js';
import { TimeoutError } from '../../action.js';

const originalFetch = global.fetch;
const location = { path: '/', pathParams: {}, searchParams: {} };
const noopCallbacks = {
  onChunk: () => {},
  onError: () => {},
  onEnd: () => {},
};

describe('fetchLoaderData timeout handling', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('throws TimeoutError when the server returns a 504 timeout envelope', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ __outcome: 'timeout', timeoutMs: 7000 }),
        { status: 504, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const controller = new AbortController();
    let thrown: unknown;
    try {
      await fetchLoaderData('m', 'l', location, controller.signal, noopCallbacks);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    if (thrown instanceof TimeoutError) {
      expect(thrown.timeoutMs).toBe(7000);
      expect(thrown.name).toBe('TimeoutError');
    }
  });

  it('throws TimeoutError when the first SSE event is event: timeout', async () => {
    const body =
      'event: timeout\ndata: {"timeoutMs":120}\n\n';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const controller = new AbortController();
    let thrown: unknown;
    try {
      await fetchLoaderData('m', 'l', location, controller.signal, noopCallbacks);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    if (thrown instanceof TimeoutError) {
      expect(thrown.timeoutMs).toBe(120);
    }
  });

  it('reports TimeoutError via onError when timeout fires mid-stream (after first chunk)', async () => {
    const body =
      'event: message\ndata: "first"\n\n' +
      'event: timeout\ndata: {"timeoutMs":250}\n\n';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const controller = new AbortController();
    const onError = vi.fn();
    const callbacks = { onChunk: () => {}, onError, onEnd: () => {} };
    const first = await fetchLoaderData('m', 'l', location, controller.signal, callbacks);
    expect(first).toBe('first');
    // Wait a tick for the background consumer to drain.
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(TimeoutError);
    if (err instanceof TimeoutError) {
      expect(err.timeoutMs).toBe(250);
    }
  });
});
