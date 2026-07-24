// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/preact';
import { defineChannel } from '../../define-channel.js';
import { defineRoom } from '../../define-room.js';
import { useRoom } from '../../use-room.js';
import { FORM_MODULE_FIELD, FORM_ROOM_FIELD } from '../contract.js';

// A minimal fake WebSocket that captures the instance so the test can push
// frames and fire lifecycle events.
class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const channel = defineChannel('demo')<{ x: number }>();
// Bare `defineRoom` carries no module/room key (the build's `.server` import
// transform is what normally stamps those on the client stub); stitch them on
// here so the hook's `ready` gate actually opens a connection under test,
// mirroring the hand-built `RoomRef` in use-room.test.tsx.
const room = {
  ...defineRoom(channel, { presence: () => ({ x: 0 }) }),
  [FORM_MODULE_FIELD]: 'pages/demo.server',
  [FORM_ROOM_FIELD]: 'demo',
};

afterEach(() => {
  cleanup();
  FakeWS.last = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRoom roster store wiring (default impl)', () => {
  it('exposes memberIds and member(id) tracking the wire snapshot and deltas', async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const { result } = renderHook(() => useRoom(room, { presence: { x: 0 } }));

    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'me', state: { x: 0 } }],
      });
    });

    expect(result.current.memberIds.value).toEqual(['me']);
    expect(result.current.member('me').value).toEqual({
      id: 'me',
      state: { x: 0 },
    });
    // members array is unchanged behaviour.
    expect(result.current.members.map((m) => m.id)).toEqual(['me']);

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'join',
        from: 'peer',
        state: { x: 5 },
      });
    });
    expect(result.current.memberIds.value).toEqual(['me', 'peer']);
    expect(result.current.member('peer').value).toEqual({
      id: 'peer',
      state: { x: 5 },
    });

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'leave',
        from: 'peer',
        state: undefined,
      });
    });
    expect(result.current.memberIds.value).toEqual(['me']);
    expect(result.current.member('peer').value).toBeUndefined();
  });

  it('renders an empty roster on first render (SSR parity)', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const { result } = renderHook(() => useRoom(room, { presence: { x: 0 } }));
    expect(result.current.memberIds.value).toEqual([]);
    expect(result.current.member('anyone').value).toBeUndefined();
    expect(result.current.members).toEqual([]);
  });
});
