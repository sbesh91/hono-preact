// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
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

describe('useRoom roster store wiring', () => {
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
    // `members` is a SIGNAL, like its two siblings.
    expect(result.current.members.value.map((m) => m.id)).toEqual(['me']);

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
    expect(result.current.members.value).toEqual([]);
  });
});

// T3 (review round 3). `members` used to be a lazy getter returning the array
// itself. Reading it DURING RENDER subscribed the reader and worked; reading it
// from an effect returned a dead snapshot, and since `useRoom` no longer
// re-renders on presence frames (the granularity win), nothing ever re-ran the
// effect. An imperative consumer -- a canvas cursor layer, a WebGL avatar strip,
// anything syncing the roster into a non-Preact widget -- froze on the roster it
// captured at mount, silently.
//
// The type was the actual defect: `ReadonlyArray` on a reactive value, next to a
// `memberIds` and a `member(id)` that both announced themselves as signals.
// `.subscribe()` is the read path that works from ANY context, and it only
// exists if the type admits there is a signal.
describe('T3: the roster is observable from outside render', () => {
  it('notifies a subscriber taken in an effect on join and on leave', async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const seen: number[] = [];
    const { result } = renderHook(() => {
      const r = useRoom(room, { presence: { x: 0 } });
      // The imperative shape: subscribe once, never read during render.
      useEffect(() => r.members.subscribe((ms) => seen.push(ms.length)), []);
      return r;
    });

    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'me', state: { x: 0 } }],
      });
    });
    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'join',
        from: 'peer',
        state: { x: 5 },
      });
    });
    // The join must reach the subscriber. Under the old getter this stayed at
    // the mount-time roster forever.
    expect(seen[seen.length - 1]).toBe(2);

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'leave',
        from: 'peer',
        state: undefined,
      });
    });
    expect(seen[seen.length - 1]).toBe(1);
    // Asserting the LAST value only would pass against a subscriber that fired
    // once and happened to land on 1, so pin that it saw the rise too.
    expect(seen).toContain(2);
    // The hook host itself must still not re-render per frame; that is the
    // granularity this design bought. `result.current` is the same object.
    expect(result.current.members.value.map((m) => m.id)).toEqual(['me']);
  });

  it("notifies a `self` subscriber when this client's own presence echoes", async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const seen: unknown[] = [];
    renderHook(() => {
      const r = useRoom(room, { presence: { x: 0 } });
      useEffect(() => r.self.subscribe((m) => seen.push(m?.state)), []);
      return r;
    });

    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'me',
        members: [{ id: 'me', state: { x: 0 } }],
      });
    });
    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'update',
        from: 'me',
        state: { x: 9 },
      });
    });
    expect(seen[seen.length - 1]).toEqual({ x: 9 });
  });
});
