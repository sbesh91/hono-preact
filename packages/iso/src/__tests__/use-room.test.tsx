// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useRoom } from '../use-room.js';
import type { RoomRef } from '../define-room.js';
import {
  FORM_MODULE_FIELD,
  FORM_ROOM_FIELD,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_ROOM_PARAM,
} from '../internal/contract.js';
import type {
  RoomEnvelope,
  RoomClientFrame,
} from '../internal/room-envelope.js';
import { env } from '../is-browser.js';

// ---------------------------------------------------------------------------
// Minimal fake WebSocket harness (mirrors use-socket.test.tsx)
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
// A trivially shaped RoomRef for tests.
// ---------------------------------------------------------------------------

type ChatMsg = { text: string };
type Presence = { name: string; color: string };
// RoomRef<Incoming, Outgoing, State, Params>.
type TestRoomRef = RoomRef<ChatMsg, ChatMsg, Presence, { roomId: string }>;

const roomRef: TestRoomRef = {
  [FORM_MODULE_FIELD]: 'pages/board.server',
  [FORM_ROOM_FIELD]: 'board',
};

// Envelope/frame aliases for assertions.
type TestEnvelope = RoomEnvelope<ChatMsg, Presence>;
type TestFrame = RoomClientFrame<ChatMsg, Presence>;

// ---------------------------------------------------------------------------
// Helper component + result capture
// ---------------------------------------------------------------------------

type Result = ReturnType<typeof useRoom<TestRoomRef>>;
type Opts = Parameters<typeof useRoom<TestRoomRef>>[1];

function Harness({
  opts,
  onResult,
}: {
  opts?: Opts;
  onResult: (r: Result) => void;
}) {
  const result = useRoom(roomRef, opts);
  onResult(result);
  return null;
}

function parseFrame(call: unknown): TestFrame {
  return JSON.parse(call as string) as TestFrame;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRoom', () => {
  it('connect URL carries m/s and r=JSON.stringify(key)', async () => {
    await act(async () => {
      render(
        <Harness opts={{ key: { roomId: 'r1' } }} onResult={() => undefined} />
      );
    });

    expect(lastWS).not.toBeNull();
    const url = new URL(lastWS!.url);
    expect(url.searchParams.get(SOCKET_MODULE_PARAM)).toBe(
      'pages/board.server'
    );
    expect(url.searchParams.get(SOCKET_NAME_PARAM)).toBe('board');
    expect(url.searchParams.get(SOCKET_ROOM_PARAM)).toBe(
      JSON.stringify({ roomId: 'r1' })
    );
  });

  it('status goes connecting -> open on open event', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(result.status).toBe('connecting');

    await act(async () => {
      lastWS!._open();
    });

    expect(result.status).toBe('open');
  });

  it('snapshot seeds members and sets self by env.self id', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    await act(async () => {
      lastWS!._open();
    });

    const snapshot: TestEnvelope = {
      t: 'snapshot',
      self: 'me',
      members: [
        { id: 'me', state: { name: 'Me', color: 'blue' } },
        { id: 'other', state: { name: 'Other', color: 'green' } },
      ],
    };
    await act(async () => {
      lastWS!._message(snapshot);
    });

    expect(result.members).toHaveLength(2);
    expect(result.members.map((m) => m.id)).toEqual(['me', 'other']);
    expect(result.self).toEqual({
      id: 'me',
      state: { name: 'Me', color: 'blue' },
    });
  });

  it('presence join adds a member', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });
    await act(async () => {
      const snap: TestEnvelope = { t: 'snapshot', self: 'me', members: [] };
      lastWS!._message(snap);
    });

    const join: TestEnvelope = {
      from: 'u1',
      t: 'presence',
      op: 'join',
      state: { name: 'Alice', color: 'red' },
    };
    await act(async () => {
      lastWS!._message(join);
    });

    expect(result.members).toEqual([
      { id: 'u1', state: { name: 'Alice', color: 'red' } },
    ]);
  });

  it('presence update changes a member state', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });
    await act(async () => {
      const snap: TestEnvelope = {
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'u1', state: { name: 'Alice', color: 'red' } }],
      };
      lastWS!._message(snap);
    });

    const upd: TestEnvelope = {
      from: 'u1',
      t: 'presence',
      op: 'update',
      state: { name: 'Alice', color: 'green' },
    };
    await act(async () => {
      lastWS!._message(upd);
    });

    expect(result.members).toEqual([
      { id: 'u1', state: { name: 'Alice', color: 'green' } },
    ]);
  });

  it('presence leave removes a member', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });
    await act(async () => {
      const snap: TestEnvelope = {
        t: 'snapshot',
        self: 'me',
        members: [
          { id: 'u1', state: { name: 'Alice', color: 'red' } },
          { id: 'u2', state: { name: 'Bob', color: 'blue' } },
        ],
      };
      lastWS!._message(snap);
    });

    const leave: TestEnvelope = { from: 'u1', t: 'presence', op: 'leave' };
    await act(async () => {
      lastWS!._message(leave);
    });

    expect(result.members).toEqual([
      { id: 'u2', state: { name: 'Bob', color: 'blue' } },
    ]);
  });

  it('self stays in sync when a presence delta mutates the self member', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });
    await act(async () => {
      const snap: TestEnvelope = {
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'me', state: { name: 'Me', color: 'blue' } }],
      };
      lastWS!._message(snap);
    });

    // Server echoes the client's own presence update back keyed by 'me'.
    const upd: TestEnvelope = {
      from: 'me',
      t: 'presence',
      op: 'update',
      state: { name: 'Me', color: 'purple' },
    };
    await act(async () => {
      lastWS!._message(upd);
    });

    expect(result.self).toEqual({
      id: 'me',
      state: { name: 'Me', color: 'purple' },
    });
  });

  it('msg envelope calls onMessage(msg, from) and does NOT add to members', async () => {
    const onMessage = vi.fn();
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' }, onMessage }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });
    await act(async () => {
      const snap: TestEnvelope = { t: 'snapshot', self: 'me', members: [] };
      lastWS!._message(snap);
    });

    const msg: TestEnvelope = {
      from: 'u9',
      t: 'msg',
      msg: { text: 'hello' },
    };
    await act(async () => {
      lastWS!._message(msg);
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ text: 'hello' }, 'u9');
    expect(result.members).toHaveLength(0);
  });

  it('send posts a {t:msg,msg} frame', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });

    await act(async () => {
      result.send({ text: 'hi there' });
    });

    expect(lastWS!.send).toHaveBeenCalledTimes(1);
    expect(parseFrame(lastWS!.send.mock.calls[0]![0])).toEqual({
      t: 'msg',
      msg: { text: 'hi there' },
    });
  });

  it('setPresence posts a {t:presence,state} frame', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });

    await act(async () => {
      result.setPresence({ name: 'Me', color: 'pink' });
    });

    const presenceFrame = lastWS!.send.mock.calls
      .map((c) => parseFrame(c[0]))
      .find((f) => f.t === 'presence');
    expect(presenceFrame).toEqual({
      t: 'presence',
      state: { name: 'Me', color: 'pink' },
    });
  });

  it('sends the initial presence frame on open when opts.presence is set', async () => {
    await act(async () => {
      render(
        <Harness
          opts={{
            key: { roomId: 'r1' },
            presence: { name: 'Me', color: 'teal' },
          }}
          onResult={() => undefined}
        />
      );
    });

    await act(async () => {
      lastWS!._open();
    });

    const presenceFrame = lastWS!.send.mock.calls
      .map((c) => parseFrame(c[0]))
      .find((f) => f.t === 'presence');
    expect(presenceFrame).toEqual({
      t: 'presence',
      state: { name: 'Me', color: 'teal' },
    });
  });

  it('re-sends the initial presence frame on reconnect', async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(
        <Harness
          opts={{
            key: { roomId: 'r1' },
            presence: { name: 'Me', color: 'teal' },
          }}
          onResult={() => undefined}
        />
      );
    });
    await act(async () => {
      lastWS!._open();
    });

    const first = lastWS!;
    // Abnormal close schedules a reconnect.
    await act(async () => {
      first._close(1006, '', false);
    });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(wsInstances.length).toBe(2);
    // Open the reconnected socket; it must re-send the presence frame.
    await act(async () => {
      lastWS!._open();
    });

    const presenceFrame = lastWS!.send.mock.calls
      .map((c) => parseFrame(c[0]))
      .find((f) => f.t === 'presence');
    expect(presenceFrame).toEqual({
      t: 'presence',
      state: { name: 'Me', color: 'teal' },
    });
  });

  it('does not connect when enabled is false', async () => {
    let result!: Result;
    await act(async () => {
      render(
        <Harness
          opts={{ key: { roomId: 'r1' }, enabled: false }}
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
      render(
        <Harness
          opts={{ key: { roomId: 'r1' } }}
          onResult={(r) => (result = r)}
        />
      );
    });

    expect(lastWS).toBeNull();
    expect(result.status).toBe('connecting');
  });
});
