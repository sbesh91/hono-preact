import { describe, it, expect, vi } from 'vitest';
import { defineChannel, defineRoom } from '@hono-preact/iso';
import type { RoomDef, RoomEnvelope } from '@hono-preact/iso/internal';
import {
  engineJoin,
  engineMessage,
  engineClose,
  type RoomTransport,
} from '../room-engine.js';

// ---------------------------------------------------------------------------
// Fake transport: records sendTo/broadcast calls and holds an in-memory roster.
// It is the platform-free stand-in the engine drives; no pubsub, no presence,
// no hono. Sender-exclude on Node is a RECEIVER-side concern, so the fake does
// not model it: it just records the (env, excludeConnId) pairs the engine asks
// for, which is exactly what the engine contract is about.
// ---------------------------------------------------------------------------

type AnyEnvelope = RoomEnvelope<unknown, unknown>;

interface SendToCall {
  connId: string;
  env: AnyEnvelope;
}
interface BroadcastCall {
  env: AnyEnvelope;
  excludeConnId?: string;
}

function makeFakeTransport(
  connId: string,
  data: unknown = { tag: 'edge' }
): {
  transport: RoomTransport;
  sentTo: SendToCall[];
  broadcasts: BroadcastCall[];
  roster: Map<string, unknown>;
} {
  const sentTo: SendToCall[] = [];
  const broadcasts: BroadcastCall[] = [];
  const roster = new Map<string, unknown>();
  const transport: RoomTransport = {
    connId,
    sendTo(toId, env) {
      sentTo.push({ connId: toId, env });
    },
    broadcast(env, excludeConnId) {
      broadcasts.push({ env, excludeConnId });
    },
    joinPresence(id, state) {
      roster.set(id, state);
    },
    leavePresence(id) {
      roster.delete(id);
    },
    updatePresence(id, state) {
      if (roster.has(id)) roster.set(id, state);
    },
    roster() {
      return [...roster].map(([id, state]) => ({ id, state }));
    },
    data() {
      return data;
    },
  };
  return { transport, sentTo, broadcasts, roster };
}

const channel = defineChannel('room/:roomId')<{ text: string }>();

function makeDef(
  handler: Parameters<typeof defineRoom>[1]
): RoomDef<unknown, unknown, unknown, unknown, unknown> {
  return defineRoom(channel, handler) as unknown as RoomDef<
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >;
}

const PARAMS = { roomId: 'demo' };

// `close` is transport-specific; the engine never closes a connection itself,
// so the tests pass a no-op stub.
const noopClose = () => {};

describe('room-engine', () => {
  it('join sends a snapshot{self,members} to the joiner and broadcasts presence/join excluding the joiner', async () => {
    const { transport, sentTo, broadcasts, roster } = makeFakeTransport('A');
    // Seed a pre-existing member so the snapshot roster is non-trivial.
    roster.set('Z', { name: 'Z' });

    const def = makeDef({ presence: () => ({ name: 'A' }) });
    await engineJoin(transport, def, PARAMS, noopClose);

    // The joiner is in the roster with its seeded presence.
    expect(roster.get('A')).toEqual({ name: 'A' });

    // A snapshot was sent DIRECTLY to the joiner (self), carrying self + members.
    const snap = sentTo.find((s) => s.env.t === 'snapshot');
    expect(snap).toBeDefined();
    expect(snap!.connId).toBe('A');
    expect(snap!.env).toMatchObject({ t: 'snapshot', self: 'A' });
    const members = (snap!.env as { members: { id: string }[] }).members;
    expect(members.map((m) => m.id).sort()).toEqual(['A', 'Z']);

    // A presence/join was broadcast, excluding the joiner.
    const join = broadcasts.find(
      (b) => b.env.t === 'presence' && b.env.op === 'join'
    );
    expect(join).toBeDefined();
    expect(join!.excludeConnId).toBe('A');
    expect(join!.env).toMatchObject({
      from: 'A',
      t: 'presence',
      op: 'join',
      state: { name: 'A' },
    });
  });

  it('runs onJoin with the conn + params and returns its teardown', async () => {
    const { transport } = makeFakeTransport('A');
    const teardown = vi.fn();
    let seenParams: unknown;
    let seenData: unknown;
    const def = makeDef({
      onJoin(conn, ctx) {
        seenParams = ctx.params;
        seenData = conn.data;
        return teardown;
      },
    });

    const ret = await engineJoin(transport, def, PARAMS, noopClose);
    expect(seenParams).toEqual(PARAMS);
    expect(seenData).toEqual({ tag: 'edge' });
    expect(ret).toBe(teardown);
    expect(teardown).not.toHaveBeenCalled();
  });

  it('conn.broadcast(msg) broadcasts a msg env excluding the sender (self)', async () => {
    const { transport, broadcasts } = makeFakeTransport('A');
    let conn: { broadcast(m: unknown): void } | undefined;
    const def = makeDef({
      onJoin(c) {
        conn = c;
      },
    });
    await engineJoin(transport, def, PARAMS, noopClose);
    const before = broadcasts.length;

    conn!.broadcast({ text: 'hi' });

    const after = broadcasts.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]!.env).toMatchObject({
      from: 'A',
      t: 'msg',
      msg: { text: 'hi' },
    });
    expect(after[0]!.excludeConnId).toBe('A');
  });

  it('conn.broadcast(msg, {self:true}) ALSO sendTo(self)', async () => {
    const { transport, broadcasts, sentTo } = makeFakeTransport('A');
    let conn:
      | { broadcast(m: unknown, o?: { self?: boolean }): void }
      | undefined;
    const def = makeDef({
      onJoin(c) {
        conn = c;
      },
    });
    await engineJoin(transport, def, PARAMS, noopClose);
    const bBefore = broadcasts.length;
    const sBefore = sentTo.length;

    conn!.broadcast({ text: 'yo' }, { self: true });

    // Still broadcasts with the sender excluded.
    const bAfter = broadcasts.slice(bBefore);
    expect(bAfter).toHaveLength(1);
    expect(bAfter[0]!.excludeConnId).toBe('A');
    expect(bAfter[0]!.env).toMatchObject({
      from: 'A',
      t: 'msg',
      msg: { text: 'yo' },
    });

    // AND a direct copy was sent to the sender (self).
    const sAfter = sentTo.slice(sBefore);
    expect(sAfter).toHaveLength(1);
    expect(sAfter[0]!.connId).toBe('A');
    expect(sAfter[0]!.env).toMatchObject({
      from: 'A',
      t: 'msg',
      msg: { text: 'yo' },
    });
  });

  it('a {t:presence} frame updates presence + broadcasts presence/update', async () => {
    const { transport, broadcasts, roster } = makeFakeTransport('A');
    const def = makeDef({ presence: () => ({ typing: false }) });
    await engineJoin(transport, def, PARAMS, noopClose);
    const before = broadcasts.length;

    await engineMessage(
      transport,
      def,
      JSON.stringify({ t: 'presence', state: { typing: true } }),
      noopClose
    );

    // The roster reflects the new state.
    expect(roster.get('A')).toEqual({ typing: true });

    // A presence/update was broadcast (forwarded to everyone; not self-excluded
    // at publish time on Node, but the engine emits it unconditionally).
    const upd = broadcasts
      .slice(before)
      .find((b) => b.env.t === 'presence' && b.env.op === 'update');
    expect(upd).toBeDefined();
    expect(upd!.env).toMatchObject({
      from: 'A',
      t: 'presence',
      op: 'update',
      state: { typing: true },
    });
  });

  it('a {t:msg} frame calls onMessage with the inner payload', async () => {
    const { transport } = makeFakeTransport('A');
    const onMessage = vi.fn();
    const def = makeDef({ onMessage });
    await engineJoin(transport, def, PARAMS, noopClose);

    await engineMessage(
      transport,
      def,
      JSON.stringify({ t: 'msg', msg: { text: 'hi' } }),
      noopClose
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]![1]).toEqual({ text: 'hi' });
  });

  it('a malformed (non-JSON) frame is a no-op (no throw, no onMessage)', async () => {
    const { transport, broadcasts } = makeFakeTransport('A');
    const onMessage = vi.fn();
    const def = makeDef({ onMessage });
    await engineJoin(transport, def, PARAMS, noopClose);
    const before = broadcasts.length;

    await expect(
      engineMessage(transport, def, 'not-json{', noopClose)
    ).resolves.toBeUndefined();

    expect(onMessage).not.toHaveBeenCalled();
    expect(broadcasts.slice(before)).toHaveLength(0);
  });

  it('an unknown-`t` frame is dropped (onMessage not called)', async () => {
    const { transport } = makeFakeTransport('A');
    const onMessage = vi.fn();
    const def = makeDef({ onMessage });
    await engineJoin(transport, def, PARAMS, noopClose);

    await engineMessage(
      transport,
      def,
      JSON.stringify({ t: 'bogus', whatever: 1 }),
      noopClose
    );

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('close broadcasts presence/leave and removes from roster, but does NOT call onLeave', async () => {
    // engineClose is the PROTOCOL half of the leave sequence: it removes the
    // connection from the roster and broadcasts the presence/leave. It does NOT
    // call def.onLeave; that is the transport runtime's responsibility, run
    // AFTER engineClose, unsub, and the onJoin teardown (onLeave last).
    const { transport, broadcasts, roster } = makeFakeTransport('A');
    const onLeave = vi.fn();
    const def = makeDef({ onLeave });
    await engineJoin(transport, def, PARAMS, noopClose);
    expect(roster.has('A')).toBe(true);
    const before = broadcasts.length;

    engineClose(transport, def, noopClose);

    // Left the roster.
    expect(roster.has('A')).toBe(false);

    // A presence/leave was broadcast.
    const leave = broadcasts
      .slice(before)
      .find((b) => b.env.t === 'presence' && b.env.op === 'leave');
    expect(leave).toBeDefined();
    expect(leave!.env).toMatchObject({ from: 'A', t: 'presence', op: 'leave' });

    // onLeave must NOT be called by the engine: the transport runtime owns it.
    expect(onLeave).not.toHaveBeenCalled();
  });
});
