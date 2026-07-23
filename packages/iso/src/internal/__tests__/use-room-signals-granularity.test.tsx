// @vitest-environment happy-dom
// The headline proof, THROUGH useRoom (not the store in isolation): with the
// signals entry installed, a presence update re-renders only the moved member's
// row. Neither the mapping consumer nor the other rows re-render, and crucially
// useRoom itself does not re-render (it no longer calls setMembers in signal
// mode). This is what makes the win real for a real consumer, with no memo.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { defineChannel } from '../../define-channel.js';
import { defineRoom } from '../../define-room.js';
import { useRoom } from '../../use-room.js';
import { FORM_MODULE_FIELD, FORM_ROOM_FIELD } from '../contract.js';
import { registerPresenceReactiveImpl } from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';

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
  registerPresenceReactiveImpl(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRoom granularity through the hook (signal mode)', () => {
  it('a presence update re-renders only the moved row, not the consumer or siblings', async () => {
    installPresenceSignals();
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const boardRenders = vi.fn();
    const rowRenders: Record<string, number> = { a: 0, b: 0 };

    function Row({ id, room }: { id: string; room: RoomHook }) {
      rowRenders[id] = (rowRenders[id] ?? 0) + 1;
      const m = room.member(id);
      return <li data-testid={`row-${id}`}>{String(m.value?.state?.x)}</li>;
    }

    function Board() {
      boardRenders();
      const r = useRoom(room, { presence: { x: 0 } });
      return (
        <ul>
          {r.memberIds.value.map((id) => (
            <Row key={id} id={id} room={r} />
          ))}
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
    const boardAfterSnapshot = boardRenders.mock.calls.length;
    const bAfterSnapshot = rowRenders.b;

    // Presence UPDATE to member a only.
    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'update',
        from: 'a',
        state: { x: 9 },
      });
    });

    expect(screen.getByTestId('row-a').textContent).toBe('9');
    // The payoff, verified through the real hook:
    // - the moved row updated,
    // - member b's row did NOT re-render,
    // - the Board (which called useRoom and mapped the list) did NOT re-render.
    expect(rowRenders.b).toBe(bAfterSnapshot);
    expect(boardRenders.mock.calls.length).toBe(boardAfterSnapshot);
  });

  it('a coarse `members` consumer still updates on any presence change', async () => {
    installPresenceSignals();
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    function Counter() {
      const r = useRoom(room, { presence: { x: 0 } });
      // Reading `members` subscribes to the whole roster (coarse), so this
      // updates on any member change even in signal mode.
      return <p data-testid="count">{r.members.length}</p>;
    }

    render(<Counter />);
    await act(async () => {
      FakeWS.last!.open();
      FakeWS.last!.message({
        t: 'snapshot',
        self: 'a',
        members: [{ id: 'a', state: { x: 1 } }],
      });
    });
    expect(screen.getByTestId('count').textContent).toBe('1');

    await act(async () => {
      FakeWS.last!.message({
        t: 'presence',
        op: 'join',
        from: 'b',
        state: { x: 2 },
      });
    });
    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});
