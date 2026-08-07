// @vitest-environment happy-dom
// The reconnect budget (`retryCountRef`) resets in `onopen`, i.e. only when a
// connection actually succeeds. Nothing reset it when the lifecycle EFFECT
// re-ran, so once the budget was spent it stayed spent for the ref's lifetime:
// toggling `enabled` off and on again -- the documented way to recover a dead
// connection -- re-entered the effect with the counter still at `maxRetries`,
// so the retry branch was false on the very first close and the recovery
// attempt got one connect with nothing behind it.
//
// Counted by construction attempts rather than by status, because the defect is
// about how many times the transport is retried, not what the UI displays.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useWsLifecycle } from '../ws-lifecycle.js';

type FakeWs = {
  url: string;
  readyState: number;
  close: (code?: number, reason?: string) => void;
  send: (d: string) => void;
  onopen: (() => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
};

const built: FakeWs[] = [];

function installFakeWebSocket() {
  built.length = 0;
  class Fake {
    url: string;
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      built.push(this as unknown as FakeWs);
    }
    close() {
      this.readyState = 3;
    }
    send() {}
  }
  vi.stubGlobal('WebSocket', Fake as unknown as typeof WebSocket);
}

/** Drive the most recently built socket through an abnormal close. */
function dropLast() {
  const ws = built[built.length - 1]!;
  ws.readyState = 3;
  ws.onclose?.({ code: 1006, reason: '', wasClean: false } as CloseEvent);
}

function Harness({ enabled }: { enabled: boolean }) {
  useWsLifecycle({
    buildUrl: () => 'ws://x/y',
    enabled,
    ready: true,
    deps: [],
    reconnect: { maxRetries: 2, minDelay: 1, maxDelay: 1, growth: 1 },
  });
  return null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reconnect budget across lifecycle re-entry', () => {
  it('a re-entered effect gets a fresh retry budget', async () => {
    vi.useFakeTimers();
    installFakeWebSocket();

    const { rerender } = render(<Harness enabled={true} />);
    expect(built).toHaveLength(1);

    // Spend the budget: maxRetries=2, so two retries then give up.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        dropLast();
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    const afterExhaustion = built.length;
    // 1 initial + 2 retries; the third close finds the budget spent.
    expect(afterExhaustion).toBe(3);

    // The documented recovery hatch: toggle `enabled` off and back on.
    await act(async () => {
      rerender(<Harness enabled={false} />);
    });
    await act(async () => {
      rerender(<Harness enabled={true} />);
    });
    const afterReenable = built.length;
    expect(afterReenable).toBe(afterExhaustion + 1); // the fresh connect

    // THE POINT: that fresh lifecycle must be able to retry again. Under the
    // defect the counter was still at maxRetries, so this close retried zero
    // times.
    await act(async () => {
      dropLast();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(built.length).toBeGreaterThan(afterReenable);
  });

  it('CONTROL: the budget is still bounded within one lifecycle', async () => {
    // Stops the fix from being satisfied by a counter that never counts, which
    // would retry forever.
    vi.useFakeTimers();
    installFakeWebSocket();

    render(<Harness enabled={true} />);
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        dropLast();
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    // 1 initial + exactly 2 retries, no more, however many times it drops.
    expect(built).toHaveLength(3);
  });
});
