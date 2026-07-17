// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { defineAction } from '../action.js';
import { useOptimisticAction } from '../optimistic-action.js';

const originalFetch = global.fetch;

describe('useOptimisticAction transition forwarding', () => {
  let originalSVT: typeof document.startViewTransition | undefined;
  beforeEach(() => {
    originalSVT = document.startViewTransition;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  afterEach(() => {
    if (originalSVT === undefined) {
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    } else {
      document.startViewTransition = originalSVT;
    }
    global.fetch = originalFetch;
  });

  it('wraps settle in startViewTransition when transition: true', async () => {
    const spy = vi.fn((cb: () => void) => {
      cb();
      return {
        finished: Promise.resolve(),
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    });
    document.startViewTransition = spy as never;

    const stub = defineAction(async () => ({ ok: true }), {
      __module: 'm',
      __action: 'a',
    });

    const { result } = renderHook(() =>
      useOptimisticAction<{}, { ok: true }, number>(stub, {
        base: 0,
        apply: (acc) => acc + 1,
        transition: true,
      })
    );

    await act(async () => {
      await result.current.mutate({});
    });
    // Initial mutate: no transition. onSuccess -> settle: one transition.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
