import { describe, it, expect, vi } from 'vitest';
import {
  makeCfRoomTransport,
  type DOConnState,
  type RoomConnAttachment,
} from '../room-do-transport.js';

// ---------------------------------------------------------------------------
// Fake DOConnState
// ---------------------------------------------------------------------------

interface FakeConn {
  id: string;
  attachment: RoomConnAttachment;
  send: ReturnType<typeof vi.fn>;
}

function makeFakeConn(
  id: string,
  overrides: Partial<RoomConnAttachment> = {}
): FakeConn {
  const attachment: RoomConnAttachment = {
    connId: id,
    moduleKey: 'test-module',
    name: 'test-room',
    params: {},
    data: null,
    presence: null,
    ...overrides,
  };
  return { id, attachment, send: vi.fn() };
}

function makeFakeStore(conns: FakeConn[]): DOConnState {
  return {
    all() {
      return conns.map((c) => ({
        id: c.id,
        send: (data: string) => c.send(data),
        getState: () => c.attachment,
      }));
    },
    get(connId) {
      const c = conns.find((x) => x.id === connId);
      if (!c) return undefined;
      return {
        send: (data: string) => c.send(data),
        getState: () => c.attachment,
        setState: (s: RoomConnAttachment) => {
          c.attachment = s;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSent(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.map((args: unknown[]) =>
    JSON.parse(args[0] as string)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeCfRoomTransport', () => {
  it('broadcast reaches ALL conns when no excludeConnId given', () => {
    const a = makeFakeConn('a');
    const b = makeFakeConn('b');
    const c = makeFakeConn('c');
    const store = makeFakeStore([a, b, c]);
    const t = makeCfRoomTransport('a', store);

    const env = { t: 'msg' as const, from: 'a', msg: 'hello' };
    t.broadcast(env);

    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(c.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(a.send.mock.calls[0][0])).toEqual(env);
  });

  it('broadcast excludes the specified connId', () => {
    const a = makeFakeConn('a');
    const b = makeFakeConn('b');
    const c = makeFakeConn('c');
    const store = makeFakeStore([a, b, c]);
    const t = makeCfRoomTransport('a', store);

    const env = { t: 'msg' as const, from: 'a', msg: 'hi' };
    t.broadcast(env, 'a');

    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('sendTo targets exactly one conn', () => {
    const a = makeFakeConn('a');
    const b = makeFakeConn('b');
    const store = makeFakeStore([a, b]);
    const t = makeCfRoomTransport('a', store);

    const env = { t: 'msg' as const, from: 'a', msg: 'direct' };
    t.sendTo('b', env);

    expect(a.send).not.toHaveBeenCalled();
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(b.send.mock.calls[0][0])).toEqual(env);
  });

  it('sendTo is a no-op for an unknown connId', () => {
    const a = makeFakeConn('a');
    const store = makeFakeStore([a]);
    const t = makeCfRoomTransport('a', store);

    expect(() =>
      t.sendTo('ghost', { t: 'msg' as const, from: 'a', msg: 'nope' })
    ).not.toThrow();
    expect(a.send).not.toHaveBeenCalled();
  });

  it('roster reflects each conn attachment presence', () => {
    const a = makeFakeConn('a', { presence: { online: true } });
    const b = makeFakeConn('b', { presence: { online: false } });
    const store = makeFakeStore([a, b]);
    const t = makeCfRoomTransport('a', store);

    expect(t.roster()).toEqual([
      { id: 'a', state: { online: true } },
      { id: 'b', state: { online: false } },
    ]);
  });

  it('joinPresence mutates only presence, leaves other fields intact', () => {
    const a = makeFakeConn('a', { data: { uid: 42 }, presence: null });
    const store = makeFakeStore([a]);
    const t = makeCfRoomTransport('a', store);

    t.joinPresence('a', { status: 'joined' });

    expect(a.attachment.presence).toEqual({ status: 'joined' });
    expect(a.attachment.data).toEqual({ uid: 42 });
    expect(t.roster()).toEqual([{ id: 'a', state: { status: 'joined' } }]);
  });

  it('updatePresence mutates only presence, leaves other fields intact', () => {
    const a = makeFakeConn('a', {
      data: { uid: 99 },
      presence: { status: 'old' },
    });
    const b = makeFakeConn('b', { presence: { status: 'unchanged' } });
    const store = makeFakeStore([a, b]);
    const t = makeCfRoomTransport('a', store);

    t.updatePresence('a', { status: 'new' });

    expect(a.attachment.presence).toEqual({ status: 'new' });
    expect(a.attachment.data).toEqual({ uid: 99 });
    expect(b.attachment.presence).toEqual({ status: 'unchanged' });
    expect(t.roster()).toEqual([
      { id: 'a', state: { status: 'new' } },
      { id: 'b', state: { status: 'unchanged' } },
    ]);
  });

  it('leavePresence is a no-op (socket removal is managed by the DO)', () => {
    const a = makeFakeConn('a', { presence: { here: true } });
    const store = makeFakeStore([a]);
    const t = makeCfRoomTransport('a', store);

    expect(() => t.leavePresence('a')).not.toThrow();
    // Presence state is unchanged; the DO hibernation removes the socket.
    expect(a.attachment.presence).toEqual({ here: true });
  });

  it('data returns the conn attachment data field', () => {
    const a = makeFakeConn('a', { data: { token: 'abc' } });
    const b = makeFakeConn('b', { data: { token: 'xyz' } });
    const store = makeFakeStore([a, b]);
    const t = makeCfRoomTransport('a', store);

    expect(t.data('a')).toEqual({ token: 'abc' });
    expect(t.data('b')).toEqual({ token: 'xyz' });
    expect(t.data('ghost')).toBeUndefined();
  });

  it('connId field matches the passed connId', () => {
    const a = makeFakeConn('conn-123');
    const store = makeFakeStore([a]);
    const t = makeCfRoomTransport('conn-123', store);

    expect(t.connId).toBe('conn-123');
  });

  it('broadcast serializes envelopes as JSON strings', () => {
    const a = makeFakeConn('a');
    const store = makeFakeStore([a]);
    const t = makeCfRoomTransport('a', store);

    const env = {
      t: 'presence' as const,
      from: 'x',
      op: 'join' as const,
      state: { active: true },
    };
    t.broadcast(env);

    const sent = parseSent(a.send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(env);
  });
});
