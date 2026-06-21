import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  defineRoom,
  defineChannel,
  defineServerMiddleware,
} from '@hono-preact/iso';
import type { RoomDef, RoomEnvelope } from '@hono-preact/iso/internal';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  __resetPubSubForTesting,
  __resetPresenceForTesting,
  roomMembers,
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_ROOM_PARAM,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal/runtime';
import { buildRoomRegistry } from '../rooms-handler.js';
import { socketsHandler } from '../sockets-handler.js';
import type { WebSocketUpgrader } from '@hono-preact/iso/internal/runtime';
import type { WSEvents } from 'hono/ws';

// ---------------------------------------------------------------------------
// Fake WebSocket harness (mirrors sockets-handler.test.ts), but captures EVERY
// connection so a single room key can be driven by two simultaneous sockets.
// ---------------------------------------------------------------------------

interface FakeWs {
  sends: string[];
  closes: { code?: number; reason?: string }[];
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function makeFakeWs(): FakeWs {
  return {
    sends: [],
    closes: [],
    send(data: string) {
      this.sends.push(data);
    },
    close(code?: number, reason?: string) {
      this.closes.push({ code, reason });
    },
  };
}

interface Conn {
  events: WSEvents;
  ws: FakeWs;
  /** Parsed RoomEnvelopes this connection has received. */
  received: () => RoomEnvelope<unknown, unknown>[];
}

function makeFakeUpgrader(): {
  upgrader: WebSocketUpgrader;
  conns: () => Conn[];
} {
  const captured: Conn[] = [];
  const upgrader: WebSocketUpgrader = (createEvents) => {
    return async (c, _next) => {
      const ws = makeFakeWs();
      const events = await createEvents(c);
      captured.push({
        events,
        ws,
        received: () =>
          ws.sends.map((s) => JSON.parse(s) as RoomEnvelope<unknown, unknown>),
      });
      return c.text('101', 101);
    };
  };
  return { upgrader, conns: () => captured };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roomChannel = defineChannel('room/:roomId')<{ text: string }>();
const MODULE_KEY = 'pages/board';
const ROOM_NAME = 'boardRoom';
const TOPIC = 'room/demo';

function makeApp(
  rooms: Map<string, RoomDef<unknown, unknown, unknown, unknown, unknown>>
): Hono {
  const app = new Hono();
  app.get(SOCKETS_RPC_PATH, socketsHandler({ registry: new Map(), rooms }));
  return app;
}

function connect(app: Hono): Promise<Response> {
  return app.request(
    `http://localhost${SOCKETS_RPC_PATH}` +
      `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
      `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
      `&${SOCKET_ROOM_PARAM}=${encodeURIComponent(TOPIC)}`
  );
}

beforeEach(() => {
  // Isolate the process-global presence + pub/sub registries per test.
  __resetPubSubForTesting();
  __resetPresenceForTesting();
});

afterEach(() => {
  __resetWebSocketUpgraderForTesting();
  __resetPubSubForTesting();
  __resetPresenceForTesting();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRoomRegistry', () => {
  it('keys room defs (channel discriminator) from serverSockets', async () => {
    const room = defineRoom(roomChannel, {}) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: MODULE_KEY,
          serverSockets: { [ROOM_NAME]: room },
        }),
    ];

    const registry = await buildRoomRegistry(serverImports);

    expect(registry.has(`${MODULE_KEY}::${ROOM_NAME}`)).toBe(true);
    expect(registry.get(`${MODULE_KEY}::${ROOM_NAME}`)).toBe(room);
  });

  it('ignores plain sockets (no channel) in the serverSockets map', async () => {
    const plainSocket = {}; // a SocketDef has no `channel`
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: MODULE_KEY,
          serverSockets: { plain: plainSocket },
        }),
    ];

    const registry = await buildRoomRegistry(serverImports);
    expect(registry.size).toBe(0);
  });
});

describe('rooms-handler: fan-out over the real in-process backend', () => {
  function makeRoomRegistry(
    handler: Parameters<typeof defineRoom>[1]
  ): Map<string, RoomDef<unknown, unknown, unknown, unknown, unknown>> {
    const room = defineRoom(roomChannel, handler) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    return new Map([[`${MODULE_KEY}::${ROOM_NAME}`, room]]);
  }

  it('(c) a newly-joined connection receives a snapshot', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({}));

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    const snapshot = a.received().find((e) => e.t === 'snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot).toMatchObject({ t: 'snapshot' });
  });

  it('(d) a join publishes a presence join the other member receives', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({ presence: () => ({ name: 'A' }) }));

    // A joins first.
    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);
    const aSendsBefore = a.ws.sends.length;

    // B joins; A should receive B's presence join.
    await connect(app);
    const b = conns()[1]!;
    await b.events.onOpen?.(new Event('open'), b.ws as never);

    const aNew = a
      .received()
      .slice(aSendsBefore)
      .filter((e) => e.t === 'presence');
    expect(aNew.some((e) => e.t === 'presence' && e.op === 'join')).toBe(true);
  });

  it('(a) broadcast reaches the other member but NOT the sender', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let aConn: { broadcast(msg: unknown): void } | undefined;
    const app = makeApp(
      makeRoomRegistry({
        onJoin(conn) {
          // Capture the first connection's RoomConnection handle.
          if (!aConn) aConn = conn;
        },
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    await connect(app);
    const b = conns()[1]!;
    await b.events.onOpen?.(new Event('open'), b.ws as never);

    const aBefore = a.ws.sends.length;
    const bBefore = b.ws.sends.length;
    aConn!.broadcast({ text: 'hi' });

    const aMsgs = a
      .received()
      .slice(aBefore)
      .filter((e) => e.t === 'msg');
    const bMsgs = b
      .received()
      .slice(bBefore)
      .filter((e) => e.t === 'msg');

    expect(bMsgs).toHaveLength(1);
    expect(bMsgs[0]).toMatchObject({ t: 'msg', msg: { text: 'hi' } });
    // Sender is excluded.
    expect(aMsgs).toHaveLength(0);
  });

  it('(b) broadcast with { self: true } ALSO reaches the sender', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let aConn:
      | { broadcast(msg: unknown, opts?: { self?: boolean }): void }
      | undefined;
    const app = makeApp(
      makeRoomRegistry({
        onJoin(conn) {
          if (!aConn) aConn = conn;
        },
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    await connect(app);
    const b = conns()[1]!;
    await b.events.onOpen?.(new Event('open'), b.ws as never);

    const aBefore = a.ws.sends.length;
    const bBefore = b.ws.sends.length;
    aConn!.broadcast({ text: 'yo' }, { self: true });

    const aMsgs = a
      .received()
      .slice(aBefore)
      .filter((e) => e.t === 'msg');
    const bMsgs = b
      .received()
      .slice(bBefore)
      .filter((e) => e.t === 'msg');

    expect(bMsgs).toHaveLength(1);
    expect(aMsgs).toHaveLength(1);
    expect(aMsgs[0]).toMatchObject({ t: 'msg', msg: { text: 'yo' } });
  });

  it('(e) a client {t:presence} frame updates presence and publishes an update', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(
      makeRoomRegistry({ presence: () => ({ typing: false }) })
    );

    // A and B both join.
    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);
    await connect(app);
    const b = conns()[1]!;
    await b.events.onOpen?.(new Event('open'), b.ws as never);

    const bBefore = b.ws.sends.length;
    // A sends a presence frame.
    await a.events.onMessage?.(
      {
        data: JSON.stringify({ t: 'presence', state: { typing: true } }),
      } as MessageEvent,
      a.ws as never
    );

    // B receives a presence update for A.
    const bNew = b
      .received()
      .slice(bBefore)
      .filter((e) => e.t === 'presence');
    const update = bNew.find((e) => e.t === 'presence' && e.op === 'update');
    expect(update).toBeDefined();
    expect(update).toMatchObject({ op: 'update', state: { typing: true } });

    // The roster reflects the new state.
    const aMember = roomMembers(TOPIC).find(
      (m) => update && 'from' in update && m.id === update.from
    );
    expect(aMember?.state).toMatchObject({ typing: true });
  });

  it('(f) close publishes a presence leave, unsubscribes, and removes the member', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({}));

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);
    await connect(app);
    const b = conns()[1]!;
    await b.events.onOpen?.(new Event('open'), b.ws as never);

    expect(roomMembers(TOPIC)).toHaveLength(2);

    const bBefore = b.ws.sends.length;
    a.events.onClose?.({ code: 1000, reason: '' } as CloseEvent, a.ws as never);

    // The leave delta reaches B.
    const bNew = b
      .received()
      .slice(bBefore)
      .filter((e) => e.t === 'presence');
    expect(bNew.some((e) => e.t === 'presence' && e.op === 'leave')).toBe(true);

    // A is gone from the roster.
    expect(roomMembers(TOPIC)).toHaveLength(1);

    // A's subscription was torn down: a fresh broadcast from B does not reach A.
    const aBefore = a.ws.sends.length;
    // B broadcasts (via a publish on the topic); A must not receive it.
    // Drive it through B's own onMessage 'msg' frame, which the runtime
    // publishes; the only remaining subscriber is B, who is excluded as sender.
    await b.events.onMessage?.(
      {
        data: JSON.stringify({ t: 'msg', msg: { text: 'after-leave' } }),
      } as MessageEvent,
      b.ws as never
    );
    const aAfter = a.ws.sends.slice(aBefore);
    expect(aAfter).toHaveLength(0);
  });

  it('(g) a denying def.use closes WS_DENY_CODE and never joins', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const onJoinSpy = vi.fn();
    const app = makeApp(
      makeRoomRegistry({
        use: [
          defineServerMiddleware(async () => {
            const { deny } = await import('@hono-preact/iso');
            throw deny('forbidden', 403);
          }),
        ],
        onJoin: onJoinSpy,
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes).toHaveLength(1);
    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
    expect(roomMembers(TOPIC)).toHaveLength(0);
  });

  it('onJoin receives params derived from the topic via extractParams', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let seenParams: unknown;
    const app = makeApp(
      makeRoomRegistry({
        onJoin(_conn, ctx) {
          seenParams = ctx.params;
        },
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(seenParams).toEqual({ roomId: 'demo' });
  });

  it('a missing room key (r) closes WS_DENY_CODE', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({}));

    // No `r` param.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });
});
