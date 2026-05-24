// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { defineAction, TimeoutError, useAction } from '../action.js';

const originalFetch = global.fetch;

describe('useAction timeout handling', () => {
  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it('surfaces a timeout envelope (504 with __outcome: timeout) as a TimeoutError', async () => {
    const stub = defineAction(async () => 1, { __module: 'm', __action: 'a' });

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'timeout', timeoutMs: 5000 }),
          { status: 504, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const { result } = renderHook(() => useAction(stub));
    let mutated: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutated = await result.current.mutate({});
    });
    expect(mutated!.ok).toBe(false);
    if (!mutated!.ok) {
      expect(mutated!.error).toBeInstanceOf(TimeoutError);
      if (mutated!.error instanceof TimeoutError) {
        expect(mutated!.error.kind).toBe('timeout');
        expect(mutated!.error.timeoutMs).toBe(5000);
      }
    }
  });

  it('surfaces an SSE event: timeout frame as a TimeoutError', async () => {
    const stub = defineAction(async () => 1, { __module: 'm', __action: 'a' });

    const body =
      'event: message\ndata: "tick"\n\n' +
      'event: timeout\ndata: {"timeoutMs":75}\n\n';
    global.fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const { result } = renderHook(() => useAction(stub));
    let mutated: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutated = await result.current.mutate({});
    });
    expect(mutated!.ok).toBe(false);
    if (!mutated!.ok) {
      expect(mutated!.error).toBeInstanceOf(TimeoutError);
      if (mutated!.error instanceof TimeoutError) {
        expect(mutated!.error.kind).toBe('timeout');
        expect(mutated!.error.timeoutMs).toBe(75);
      }
    }
  });
});
