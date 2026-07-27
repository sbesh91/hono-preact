// @vitest-environment happy-dom
// P1-2 mutation check: does the roster preserve per-member signal IDENTITY?
//
// The contract at internal/reactive.ts:24 is "One member's entry; changes only
// when THAT member changes". That only means anything if a consumer may HOLD
// the reactive it got back. Every assertion in signal-roster.test.ts re-calls
// `member(id)` FRESH after each mutation, so it can never observe a broken
// identity. These tests hold the binding across the mutation, which is exactly
// what `<For>` (the shipped list helper, documented against `memberIds`) makes
// a real consumer do.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { effect } from '@preact/signals';
import { createSignalRoster } from '../roster-signal.js';
import type { PresenceMember } from '../room-envelope.js';
import { For } from '../../for.js';
import { defineChannel } from '../../define-channel.js';
import { defineRoom } from '../../define-room.js';
import { useRoom } from '../../use-room.js';
import { FORM_MODULE_FIELD, FORM_ROOM_FIELD } from '../contract.js';

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
const room = {
  ...defineRoom(channel, { presence: () => ({ x: 0 }) }),
  [FORM_MODULE_FIELD]: 'pages/demo.server',
  [FORM_ROOM_FIELD]: 'demo',
};
type RoomHook = ReturnType<typeof useRoom<typeof room>>;

afterEach(() => {
  cleanup();
  FakeWS.last = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('P1-2 store level: a HELD member binding survives roster mutation', () => {
  it('leave() notifies a binding taken BEFORE the leave', () => {
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);

    // Hold the binding ACROSS the mutation. This is the whole point.
    const held = store.member('b');
    const seen: Array<PresenceMember<number> | undefined> = [];
    const stop = effect(() => {
      seen.push(held.value);
    });
    expect(seen).toEqual([{ id: 'b', state: 2 }]);

    store.leave('b');

    // A bound row must see its member depart.
    expect(held.value).toBeUndefined();
    // ...and must be NOTIFIED, not merely read a new value on a later render.
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeUndefined();
    stop();
  });

  it('snapshot() writes THROUGH a binding taken before the snapshot (reconnect)', () => {
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);

    const heldA = store.member('a');
    const seen: Array<PresenceMember<number> | undefined> = [];
    const stop = effect(() => {
      seen.push(heldA.value);
    });

    // Every WS reconnect re-sends the full roster (server/room-engine.ts
    // engineJoin step 2 -> use-room.ts store.snapshot).
    store.snapshot([
      { id: 'a', state: 42 },
      { id: 'b', state: 2 },
    ]);

    expect(heldA.value).toEqual({ id: 'a', state: 42 });
    expect(seen.at(-1)).toEqual({ id: 'a', state: 42 });
    stop();
  });

  it('snapshot() blanks a binding for a member no longer in the roster', () => {
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);
    const heldB = store.member('b');

    store.snapshot([{ id: 'a', state: 1 }]); // b is gone on reconnect

    expect(heldB.value).toBeUndefined();
  });

  it('member(id) taken BEFORE the join observes the join', () => {
    const store = createSignalRoster<number>();
    store.snapshot([{ id: 'a', state: 1 }]);

    const heldZ = store.member('z'); // z has not joined yet
    const seen: Array<PresenceMember<number> | undefined> = [];
    const stop = effect(() => {
      seen.push(heldZ.value);
    });
    expect(seen).toEqual([undefined]);

    store.upsert('z', 7);

    expect(heldZ.value).toEqual({ id: 'z', state: 7 });
    expect(seen.length).toBe(2);
    stop();
  });

  it('member(id) identity is stable across leave -> rejoin', () => {
    const store = createSignalRoster<number>();
    store.snapshot([{ id: 'a', state: 1 }]);
    const held = store.member('a');
    store.leave('a');
    store.upsert('a', 5);
    expect(held.value).toEqual({ id: 'a', state: 5 });
  });

  it('members[] does not surface a departed member after leave', () => {
    // Guards the proposed fix: blanking the cell must not leak an `undefined`
    // hole (or a stale entry) into the coarse `members` array.
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);
    store.member('b'); // force the cell to exist
    store.leave('b');
    expect(store.members.value).toEqual([{ id: 'a', state: 1 }]);
  });
});

describe('P1-2 end to end: a reconnect snapshot freezes every <For> row', () => {
  it('a bound row keeps rendering pre-reconnect state forever', async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    const rowRenders: Record<string, number> = { a: 0, b: 0 };

    function Row({ id, room: r }: { id: string; room: RoomHook }) {
      rowRenders[id] = (rowRenders[id] ?? 0) + 1;
      // The row holds its own binding for as long as the row lives; <For> does
      // not re-invoke a surviving row, so this call happens exactly once.
      const m = r.member(id);
      return <li data-testid={`row-${id}`}>{String(m.value?.state?.x)}</li>;
    }

    function Board() {
      const r = useRoom(room, { presence: { x: 0 } });
      return (
        <ul>
          <For each={r.memberIds}>{(id) => <Row id={id} room={r} />}</For>
        </ul>
      );
    }

    render(<Board />);

    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'a',
        members: [
          { id: 'a', state: { x: 1 } },
          { id: 'b', state: { x: 2 } },
        ],
      });
    });
    expect(screen.getByTestId('row-a').textContent).toBe('1');
    expect(screen.getByTestId('row-b').textContent).toBe('2');

    // The connection drops and re-opens: the server sends a fresh full roster.
    await act(async () => {
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'a',
        members: [
          { id: 'a', state: { x: 10 } },
          { id: 'b', state: { x: 20 } },
        ],
      });
    });

    expect(screen.getByTestId('row-a').textContent).toBe('10');
    expect(screen.getByTestId('row-b').textContent).toBe('20');

    // And a normal presence update AFTER the reconnect must still land.
    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'update',
        from: 'b',
        state: { x: 99 },
      });
    });
    expect(screen.getByTestId('row-b').textContent).toBe('99');
    // Only b's row re-rendered for that last frame.
    expect(rowRenders.a).toBeLessThanOrEqual(3);
  });

  it('a bound row is notified when its member leaves', async () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    // A row that is NOT unmounted by the list (it is rendered standalone from a
    // held binding), i.e. exactly the "changes only when THAT member changes"
    // contract a consumer is invited to rely on.
    function Watcher({ room: r }: { room: RoomHook }) {
      const m = r.member('b');
      return (
        <p data-testid="watch">
          {m.value ? `present:${m.value.state?.x}` : 'gone'}
        </p>
      );
    }
    function Board() {
      const r = useRoom(room, { presence: { x: 0 } });
      return <Watcher room={r} />;
    }

    render(<Board />);
    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'a',
        members: [
          { id: 'a', state: { x: 1 } },
          { id: 'b', state: { x: 2 } },
        ],
      });
    });
    expect(screen.getByTestId('watch').textContent).toBe('present:2');

    await act(async () => {
      FakeWS.last!.message({ t: 'presence', op: 'leave', from: 'b' });
    });
    expect(screen.getByTestId('watch').textContent).toBe('gone');
  });
});
