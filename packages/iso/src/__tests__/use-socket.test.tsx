// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useSocket } from '../use-socket.js';
import { defineSocket } from '../define-socket.js';
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

// A route-bound ref (e.g. serverRoute('/board/:id').socket(...)) carrying
// `{ id: string }` params, for the wire-encoding test below.
const boardRef: SocketRef<ChatMsg, ServerMsg, { id: string }> = {
  [FORM_MODULE_FIELD]: 'pages/board.server',
  [FORM_SOCKET_FIELD]: 'board',
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

// A second harness bound to the param-bearing ref, for the wire-encoding
// test below (its `opts.params` is required and typed, unlike `Harness`'s).
type BoardResult = ReturnType<typeof useSocket<typeof boardRef>>;

function BoardHarness({
  socketRef,
  opts,
  onResult,
}: {
  socketRef: typeof boardRef;
  opts?: Parameters<typeof useSocket<typeof boardRef>>[1];
  onResult: (r: BoardResult) => void;
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
    // lastMessage opt was not passed, so it must be undefined.
    expect(result.lastMessage).toBeUndefined();
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

// ---------------------------------------------------------------------------
// SSR ref-method: the sibling of the rooms `/demo/cursors` 500. On a hard load
// SSR imports the REAL `.server` module (the `.server`->stub transform is
// skipped for SSR), so `serverSockets.x` is the `defineSocket()` def, NOT the
// client stub. A component calling the `.useSocket()` ref-method form during
// render used to throw "useSocket is not a function" because that method was
// attached only by the client stub. `defineSocket` now attaches `.useSocket` to
// the def; with no module/socket key the hook stays disconnected during SSR.
// ---------------------------------------------------------------------------

describe('defineSocket server def (SSR ref-method)', () => {
  it('renders during SSR without throwing and opens no socket', () => {
    env.current = 'server';
    const feed = defineSocket<{ ping: string }, { pong: string }>({
      message() {},
    });

    let captured: ReturnType<typeof feed.useSocket> | undefined;
    function ServerComp() {
      captured = feed.useSocket();
      return null;
    }

    // Before the fix this throws synchronously during render.
    expect(() => render(<ServerComp />)).not.toThrow();
    expect(lastWS).toBeNull();
    expect(captured?.status).toBe('connecting');
  });
});

// ---------------------------------------------------------------------------
// Teardown honesty: when an open connection is disabled (or its identity
// changes), `status` must stop reporting 'open' so a consumer gating UI on
// `status === 'open'` does not act on a closed socket.
// ---------------------------------------------------------------------------

describe('useSocket teardown status', () => {
  it('reports "closed" when an open socket is disabled via enabled:false', async () => {
    let result!: Result;
    let utils!: ReturnType<typeof render>;

    await act(async () => {
      utils = render(
        <Harness
          socketRef={chatRef}
          opts={{ enabled: true }}
          onResult={(r) => (result = r)}
        />
      );
    });

    await act(async () => {
      lastWS!._open();
    });
    expect(result.status).toBe('open');

    // Disable: the lifecycle effect re-runs, tears down the open connection,
    // and must not keep advertising 'open'.
    await act(async () => {
      utils.rerender(
        <Harness
          socketRef={chatRef}
          opts={{ enabled: false }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(result.status).not.toBe('open');
    expect(result.status).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// Send-queue overflow is a backpressure condition, not a silent black hole:
// dropping a message past the buffer cap must emit a dev diagnostic.
// ---------------------------------------------------------------------------

describe('useSocket send-queue overflow', () => {
  it('warns (dev) when the send queue overflows while not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    // Socket is 'connecting' (never opened), so every send queues. The buffer
    // cap is 128; sends beyond it are dropped and must warn.
    await act(async () => {
      for (let i = 0; i < 130; i++) result.send({ text: `m${i}` });
    });

    expect(warn).toHaveBeenCalled();
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('send queue'))
    ).toBe(true);

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Route-bound params (#273 item 4): a param-bearing ref's `params` option is
// JSON-encoded onto the `r=` query of the upgrade URL, the same wire key
// `useRoom` uses for its channel key params.
// ---------------------------------------------------------------------------

describe('useSocket params wire encoding', () => {
  it('JSON-encodes opts.params onto the r= query of the upgrade URL', async () => {
    let result!: BoardResult;

    await act(async () => {
      render(
        <BoardHarness
          socketRef={boardRef}
          opts={{ params: { id: 'b1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(lastWS).not.toBeNull();
    expect(lastWS!.url).toContain(
      `&r=${encodeURIComponent(JSON.stringify({ id: 'b1' }))}`
    );
    // Sanity: the socket still connects normally.
    expect(result.status).toBe('connecting');
  });

  it('a bare (param-less) socket omits the r= query entirely', async () => {
    let result!: Result;

    await act(async () => {
      render(<Harness socketRef={chatRef} onResult={(r) => (result = r)} />);
    });

    expect(lastWS).not.toBeNull();
    expect(lastWS!.url).not.toContain('&r=');
    void result;
  });

  it('changing params reconnects (a new WebSocket is opened)', async () => {
    let result!: BoardResult;
    let utils!: ReturnType<typeof render>;

    await act(async () => {
      utils = render(
        <BoardHarness
          socketRef={boardRef}
          opts={{ params: { id: 'b1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(wsInstances.length).toBe(1);
    expect(lastWS!.url).toContain(
      `&r=${encodeURIComponent(JSON.stringify({ id: 'b1' }))}`
    );

    await act(async () => {
      utils.rerender(
        <BoardHarness
          socketRef={boardRef}
          opts={{ params: { id: 'b2' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(wsInstances.length).toBe(2);
    expect(lastWS!.url).toContain(
      `&r=${encodeURIComponent(JSON.stringify({ id: 'b2' }))}`
    );
    void result;
  });
});
