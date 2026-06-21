// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useSocket } from '../use-socket.js';
import type { SocketRef } from '../define-socket.js';
import { FORM_MODULE_FIELD, FORM_SOCKET_FIELD } from '../internal/contract.js';
import { env } from '../is-browser.js';

// ---------------------------------------------------------------------------
// Minimal fake WebSocket harness
// ---------------------------------------------------------------------------

type FakeWS = {
  url: string;
  readyState: number;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  // Helpers to drive events from tests.
  _open(): void;
  _message(data: unknown): void;
  _close(code: number, reason?: string, wasClean?: boolean): void;
  _error(): void;
};

let lastWS: FakeWS | null = null;
const wsInstances: FakeWS[] = [];

class FakeWebSocket implements FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn((code?: number, _reason?: string) => {
    this.readyState = FakeWebSocket.CLOSING;
    // Simulate the browser closing the connection.
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this._close(code ?? 1000, '', true);
    });
  });

  constructor(url: string) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    lastWS = this;
    wsInstances.push(this);
  }

  _open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  _message(data: unknown) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(data) })
    );
  }

  _close(code: number, reason = '', wasClean = false) {
    this.readyState = FakeWebSocket.CLOSED;
    const ev = new CloseEvent('close', { code, reason, wasClean });
    this.onclose?.(ev);
  }

  _error() {
    this.onerror?.(new Event('error'));
  }
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

const originalWS = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;

beforeEach(() => {
  lastWS = null;
  wsInstances.length = 0;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  env.current = 'browser';
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWS;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// A trivially shaped SocketRef for tests.
// ---------------------------------------------------------------------------

type ChatMsg = { text: string };
type ServerMsg = { reply: string };

const chatRef: SocketRef<ChatMsg, ServerMsg> = {
  [FORM_MODULE_FIELD]: 'pages/chat.server',
  [FORM_SOCKET_FIELD]: 'chat',
};

// ---------------------------------------------------------------------------
// Helper component + result capture
// ---------------------------------------------------------------------------

type Result = ReturnType<typeof useSocket<typeof chatRef>>;

function Harness({
  socketRef,
  opts,
  onResult,
}: {
  socketRef: typeof chatRef;
  opts?: Parameters<typeof useSocket<typeof chatRef>>[1];
  onResult: (r: Result) => void;
}) {
  const result = useSocket(socketRef, opts);
  onResult(result);
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSocket', () => {
  it('status goes connecting -> open on socket open event', async () => {
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    // After render the socket is constructed and status is 'connecting'.
    expect(result.status).toBe('connecting');
    expect(lastWS).not.toBeNull();

    // Fire the open event.
    await act(async () => {
      lastWS!._open();
    });

    expect(result.status).toBe('open');
  });

  it('send before open queues, then flushes JSON.stringify on open', async () => {
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    // Send before the socket opens; should queue, not call ws.send yet.
    await act(async () => {
      result.send({ text: 'hello' });
    });
    expect(lastWS!.send).not.toHaveBeenCalled();

    // Open the socket; queued message should flush.
    await act(async () => {
      lastWS!._open();
    });

    expect(lastWS!.send).toHaveBeenCalledTimes(1);
    expect(lastWS!.send).toHaveBeenCalledWith(
      JSON.stringify({ text: 'hello' })
    );
  });

  it('onmessage JSON invokes opts.onMessage with the parsed object', async () => {
    const onMessage = vi.fn();
    let result!: Result;

    await act(async () => {
      render(
        <Harness
          socketRef={chatRef}
          opts={{ onMessage }}
          onResult={(r) => (result = r)}
        />
      );
    });

    await act(async () => {
      lastWS!._open();
    });

    await act(async () => {
      lastWS!._message({ reply: 'world' });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ reply: 'world' });
    // onMessage does not cause a status re-render.
    expect(result.status).toBe('open');
  });

  it('close code 4403 sets closeInfo and does NOT reconnect', async () => {
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    await act(async () => {
      lastWS!._open();
    });

    const wsBeforeClose = lastWS!;

    await act(async () => {
      wsBeforeClose._close(4403, 'Forbidden');
    });

    expect(result.closeInfo).toEqual({
      code: 4403,
      reason: 'Forbidden',
      wasClean: false,
    });
    // Default shouldReconnect returns false for 4xxx codes.
    expect(result.status).toBe('closed');
    // No new WebSocket was created.
    expect(wsInstances.length).toBe(1);
  });

  it('close code 1006 schedules a reconnect (status reconnecting)', async () => {
    vi.useFakeTimers();
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    await act(async () => {
      lastWS!._open();
    });

    const wsBeforeClose = lastWS!;

    // Code 1006: abnormal closure, shouldReconnect defaults to true.
    await act(async () => {
      wsBeforeClose._close(1006, '', false);
    });

    expect(result.status).toBe('reconnecting');

    // Fast-forward past the backoff delay so the reconnect fires.
    await act(async () => {
      vi.runAllTimers();
    });

    // A new WebSocket should have been created.
    expect(wsInstances.length).toBe(2);
  });

  it('lastMessage reactive state is only populated when opts.lastMessage is true', async () => {
    let result!: Result;

    await act(async () => {
      render(
        <Harness
          socketRef={chatRef}
          opts={{ lastMessage: true }}
          onResult={(r) => (result = r)}
        />
      );
    });

    await act(async () => {
      lastWS!._open();
    });

    expect(result.lastMessage).toBeUndefined();

    await act(async () => {
      lastWS!._message({ reply: 'ping' });
    });

    expect(result.lastMessage).toEqual({ reply: 'ping' });
  });

  it('does not connect when enabled is false', async () => {
    let result!: Result;

    await act(async () => {
      render(
        <Harness
          socketRef={chatRef}
          opts={{ enabled: false }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(lastWS).toBeNull();
    expect(result.status).toBe('connecting');
  });

  it('is a no-op on the server (isBrowser returns false)', async () => {
    env.current = 'server';
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    expect(lastWS).toBeNull();
    expect(result.status).toBe('connecting');
  });

  it('close() prevents reconnect and sets status closed', async () => {
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    await act(async () => {
      lastWS!._open();
    });

    await act(async () => {
      result.close(1000, 'done');
    });

    // Wait for microtask queue (fake close fires on queueMicrotask).
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.status).toBe('closed');
    // No reconnect attempt.
    expect(wsInstances.length).toBe(1);
  });
});
