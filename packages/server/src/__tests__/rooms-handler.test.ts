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
  getPubSubBackend,
  presenceMembers,
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_KEY_PARAM,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal/runtime';
import { buildRoomRegistry, resolveRoomKey } from '../rooms-handler.js';
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
  app.get(
    SOCKETS_RPC_PATH,
    socketsHandler({ registry: new Map(), rooms, resolvePageUse: () => [] })
  );
  return app;
}

// A room app whose route-node `use` chain is delivered through resolvePageUse
// (the same mechanism createServerEntry uses). The moduleKey resolves to
// `routePath` so the route-node guard runs; the guard reads the room-key params
// off `ctx.location.pathParams`, proving the params reach the guard chain.
function makeAppWithRouteNodeUse(
  rooms: Map<string, RoomDef<unknown, unknown, unknown, unknown, unknown>>,
  routePath: string,
  pageUse: ReadonlyArray<unknown>
): Hono {
  const app = new Hono();
  app.get(
    SOCKETS_RPC_PATH,
    socketsHandler({
      registry: new Map(),
      rooms,
      resolvePageUse: (path: string) => (path === routePath ? pageUse : []),
      resolveRoutePath: (mk: string) =>
        mk === MODULE_KEY ? routePath : undefined,
    })
  );
  return app;
}

// Connect with an explicit JSON-encoded `r` (room key) param value.
function connectWithRawR(app: Hono, rawR: string): Promise<Response> {
  return app.request(
    `http://localhost${SOCKETS_RPC_PATH}` +
      `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
      `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
      `&${SOCKET_KEY_PARAM}=${encodeURIComponent(rawR)}`
  );
}

// The room param carries the JSON-encoded channel key params. The server
// interpolates the topic server-side from these params.
const ROOM_PARAMS = JSON.stringify({ roomId: 'demo' });

function connect(app: Hono): Promise<Response> {
  return app.request(
    `http://localhost${SOCKETS_RPC_PATH}` +
      `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
      `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
      `&${SOCKET_KEY_PARAM}=${encodeURIComponent(ROOM_PARAMS)}`
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
  it('keys room defs from the serverRooms export', async () => {
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
          serverRooms: { [ROOM_NAME]: room },
        }),
    ];

    const registry = await buildRoomRegistry(serverImports);

    expect(registry.has(`${MODULE_KEY}::${ROOM_NAME}`)).toBe(true);
    expect(registry.get(`${MODULE_KEY}::${ROOM_NAME}`)).toBe(room);
  });

  it('ignores entries without a channel in the serverRooms map', async () => {
    // A malformed entry without `channel` should not be registered.
    const badEntry = {};
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: MODULE_KEY,
          serverRooms: { bad: badEntry },
        }),
    ];

    const registry = await buildRoomRegistry(serverImports);
    expect(registry.size).toBe(0);
  });

  it('does not read rooms from serverSockets (rooms use the separate serverRooms export)', async () => {
    const room = defineRoom(roomChannel, {}) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    // Room placed in serverSockets (wrong export) must NOT appear in the room registry.
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: MODULE_KEY,
          serverSockets: { [ROOM_NAME]: room },
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
    const aMember = presenceMembers(TOPIC).find(
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

    expect(presenceMembers(TOPIC)).toHaveLength(2);

    const bBefore = b.ws.sends.length;
    a.events.onClose?.({ code: 1000, reason: '' } as CloseEvent, a.ws as never);

    // The leave delta reaches B.
    const bNew = b
      .received()
      .slice(bBefore)
      .filter((e) => e.t === 'presence');
    expect(bNew.some((e) => e.t === 'presence' && e.op === 'leave')).toBe(true);

    // A is gone from the roster.
    expect(presenceMembers(TOPIC)).toHaveLength(1);

    // A's subscription was torn down: a direct publish to the topic reaches B
    // (still subscribed) but NOT A (unsubscribed). The publish is done via the
    // backend directly so the test does not rely on onMessage dispatching; the
    // asymmetry between B receiving it and A not is what proves unsub() ran.
    const aBefore = a.ws.sends.length;
    const bAfterClose = b.ws.sends.length;
    const sentinel = {
      from: 'test-sentinel',
      t: 'msg' as const,
      msg: { text: 'after-leave' },
    };
    getPubSubBackend().publish(TOPIC, sentinel);
    // B is still subscribed and must receive the sentinel.
    const bGotSentinel = b
      .received()
      .slice(bAfterClose)
      .some(
        (e) =>
          e.t === 'msg' && (e as typeof sentinel).msg?.text === 'after-leave'
      );
    expect(bGotSentinel).toBe(true);
    // A is unsubscribed and must not receive anything new.
    const aAfter = a.ws.sends.slice(aBefore);
    expect(aAfter).toHaveLength(0);
  });

  it('(f2) onLeave fires AFTER the onJoin teardown (order regression)', async () => {
    // Regression: the PR 5a refactor moved onLeave into engineClose so it ran
    // BEFORE unsub and the onJoin teardown. The correct order is:
    //   engineClose (leave roster + broadcast) -> unsub -> joinTeardown -> onLeave
    // This test pins that: the teardown spy must fire BEFORE the onLeave spy.
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const callOrder: string[] = [];
    const teardownSpy = vi.fn(() => {
      callOrder.push('teardown');
    });
    const onLeaveSpy = vi.fn(() => {
      callOrder.push('onLeave');
    });

    const app = makeApp(
      makeRoomRegistry({
        onJoin() {
          return teardownSpy;
        },
        onLeave: onLeaveSpy,
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);
    a.events.onClose?.({ code: 1000, reason: '' } as CloseEvent, a.ws as never);

    // Both must have been called.
    expect(teardownSpy).toHaveBeenCalledTimes(1);
    expect(onLeaveSpy).toHaveBeenCalledTimes(1);

    // The teardown must have run BEFORE onLeave.
    expect(callOrder).toEqual(['teardown', 'onLeave']);
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
    expect(presenceMembers(TOPIC)).toHaveLength(0);
  });

  it('onJoin receives params interpolated server-side from client-sent key params', async () => {
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

    // No `r` param at all: a required param is absent.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('an empty params object (r="{}") closes WS_DENY_CODE for a :param channel', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({}));

    // The client sends valid JSON but omits the required `roomId` param.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({}))}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('invalid JSON in r closes WS_DENY_CODE', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const app = makeApp(makeRoomRegistry({}));

    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent('not-json')}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('r="null" (valid JSON, non-object) closes WS_DENY_CODE and does not join', async () => {
    // JSON.parse('null') returns null; null["roomId"] would throw a TypeError
    // if the guard were absent. The fix coerces non-plain-object parse results
    // to {} so the required-param check denies cleanly.
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const onJoinSpy = vi.fn();
    const app = makeApp(makeRoomRegistry({ onJoin: onJoinSpy }));

    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent('null')}`
    );
    const a = conns()[0]!;

    // Must not throw; the promise must resolve cleanly.
    await expect(
      a.events.onOpen?.(new Event('open'), a.ws as never)
    ).resolves.toBeUndefined();

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
    expect(presenceMembers(TOPIC)).toHaveLength(0);
  });

  it('(security) client key params are constrained to the channel namespace', async () => {
    // A client for the `room/:roomId` channel sends params for `roomId=p1`.
    // The server interpolates the topic as `room/p1`, bound to the channel's
    // namespace. The client cannot reach an unrelated topic by injecting a
    // pre-built topic string: even if the client sends `r={"roomId":"p1"}`
    // the resulting topic is always `room/p1`, never e.g. `board/p1`.
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const app = makeApp(makeRoomRegistry({}));

    // Attempt: send params that, if trusted literally as a topic, would land
    // on `board/p1` (a different channel entirely). The server must instead
    // interpolate `room/:roomId` with `{roomId: "p1"}`, landing on `room/p1`.
    const params = JSON.stringify({ roomId: 'p1' });
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(params)}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    // The connection must join `room/p1`, not `board/p1` or any other topic.
    // The roster confirms which topic the server used.
    expect(presenceMembers('room/p1')).toHaveLength(1);
    // An unrelated topic (`board/p1`) must be empty: the params never escape
    // the channel's namespace.
    expect(presenceMembers('board/p1')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Finding 2: the room-key params reach the guard chain (route-node use) via
  // ctx.location.pathParams, so resource-scoped auth works for rooms.
  // -------------------------------------------------------------------------

  it('a route-node use can read the room-key param and DENY when it is missing', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const onJoinSpy = vi.fn();
    // A route-node guard that denies unless pathParams.roomId is present.
    const requireRoomId = defineServerMiddleware(async (ctx, next) => {
      const roomId = ctx.location.pathParams.roomId;
      if (!roomId) {
        const { deny } = await import('@hono-preact/iso');
        throw deny('forbidden', 403);
      }
      await next();
    });

    const rooms = makeRoomRegistry({ onJoin: onJoinSpy });
    const app = makeAppWithRouteNodeUse(rooms, '/board', [requireRoomId]);

    // Send a param-less room key: a required `:roomId` is absent, so the
    // server-side resolveRoomKey fails AND the guard cannot see a roomId.
    // The connection must deny (onOpen closes WS_DENY_CODE), onJoin never runs.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({}))}`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
  });

  it('a route-node use that reads the room-key param ALLOWS when present', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const onJoinSpy = vi.fn();
    let seenRoomIdInGuard: string | undefined;
    const requireRoomId = defineServerMiddleware(async (ctx, next) => {
      // This is the load-bearing assertion: the room-key param reached the
      // guard chain via ctx.location.pathParams (it was {} before the fix).
      seenRoomIdInGuard = ctx.location.pathParams.roomId;
      if (!seenRoomIdInGuard) {
        const { deny } = await import('@hono-preact/iso');
        throw deny('forbidden', 403);
      }
      await next();
    });

    const rooms = makeRoomRegistry({ onJoin: onJoinSpy });
    const app = makeAppWithRouteNodeUse(rooms, '/board', [requireRoomId]);

    // Send roomId=demo; the guard sees it, allows, and onJoin runs.
    await connectWithRawR(app, JSON.stringify({ roomId: 'demo' }));
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(seenRoomIdInGuard).toBe('demo');
    expect(a.ws.closes).toHaveLength(0);
    expect(onJoinSpy).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Finding 1 (value type): a non-string param value is rejected, never cast
  // to Record<string,string> and never reaches onJoin.
  // -------------------------------------------------------------------------

  it('a NON-STRING param value closes WS_DENY_CODE and never joins', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const onJoinSpy = vi.fn();
    const app = makeApp(makeRoomRegistry({ onJoin: onJoinSpy }));

    // r={"roomId":["a","b"]} parses to a plain object but roomId is an array,
    // not a string. The old code cast this to Record<string,string> and let it
    // through; the fix rejects it.
    await connectWithRawR(app, JSON.stringify({ roomId: ['a', 'b'] }));
    const a = conns()[0]!;

    await expect(
      a.events.onOpen?.(new Event('open'), a.ws as never)
    ).resolves.toBeUndefined();

    expect(a.ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
    expect(presenceMembers(TOPIC)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Finding 1b: onMessage hardening. A malformed frame must not crash the
  // connection (no unhandled rejection); an unknown `t` is dropped.
  // -------------------------------------------------------------------------

  it('a malformed (non-JSON) frame does NOT throw and does NOT call onMessage', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const onMessageSpy = vi.fn();
    const app = makeApp(makeRoomRegistry({ onMessage: onMessageSpy }));

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    // A non-JSON frame must resolve cleanly (no unhandled rejection) and not
    // dispatch to the user onMessage.
    await expect(
      a.events.onMessage?.({ data: 'not-json{' } as MessageEvent, a.ws as never)
    ).resolves.toBeUndefined();
    expect(onMessageSpy).not.toHaveBeenCalled();
  });

  it('an unknown-`t` frame is DROPPED (onMessage is not called with undefined)', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const onMessageSpy = vi.fn();
    const app = makeApp(makeRoomRegistry({ onMessage: onMessageSpy }));

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    // A frame with an unrecognized discriminant. The old implicit else assumed
    // t === 'msg' and called onMessage(conn, frame.msg) with msg === undefined.
    await a.events.onMessage?.(
      { data: JSON.stringify({ t: 'bogus', whatever: 1 }) } as MessageEvent,
      a.ws as never
    );
    expect(onMessageSpy).not.toHaveBeenCalled();
  });

  it('data factory runs at the edge and seeds conn.data for onJoin and onMessage', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let seenDataInJoin: unknown;
    let seenDataInMessage: unknown;
    const app = makeApp(
      makeRoomRegistry({
        // The data factory captures a query param from the live Context.
        data: (c) => ({ tag: c.req.query('tag') ?? 'none' }),
        onJoin(conn) {
          seenDataInJoin = conn.data;
        },
        onMessage(conn) {
          seenDataInMessage = conn.data;
        },
      })
    );

    // Connect with ?tag=x in addition to the standard room params.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(MODULE_KEY)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(ROOM_PARAMS)}` +
        `&tag=x`
    );
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    // The data factory ran at the edge and seeded conn.data.
    expect(seenDataInJoin).toEqual({ tag: 'x' });

    // onMessage sees the same conn.data.
    await a.events.onMessage?.(
      {
        data: JSON.stringify({ t: 'msg', msg: { text: 'hi' } }),
      } as MessageEvent,
      a.ws as never
    );
    expect(seenDataInMessage).toEqual({ tag: 'x' });
  });

  it('data factory result defaults to undefined when not provided', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let seenData: unknown;
    const app = makeApp(
      makeRoomRegistry({
        // No data factory: conn.data starts as undefined.
        onJoin(conn) {
          seenData = conn.data;
        },
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    expect(seenData).toBeUndefined();
  });

  it('a well-formed {t:msg} frame still reaches onMessage (regression)', async () => {
    const { upgrader, conns } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    const received: unknown[] = [];
    const app = makeApp(
      makeRoomRegistry({
        onMessage(_conn, msg) {
          received.push(msg);
        },
      })
    );

    await connect(app);
    const a = conns()[0]!;
    await a.events.onOpen?.(new Event('open'), a.ws as never);

    await a.events.onMessage?.(
      {
        data: JSON.stringify({ t: 'msg', msg: { text: 'hi' } }),
      } as MessageEvent,
      a.ws as never
    );
    expect(received).toEqual([{ text: 'hi' }]);
  });
});

describe('resolveRoomKey', () => {
  const enc = (o: unknown) => JSON.stringify(o);

  it('(security) drops a wire key that is not a declared slot on the channel name', () => {
    // A client for `room/:roomId` sends an extra `orgId`, a key the channel
    // pattern never declared. The resolver must restrict the resolved params
    // to the channel's declared slots before the topic is computed and before
    // the params are handed onward (to the guard and to onJoin).
    const channel = defineChannel('room/:roomId')();
    const result = resolveRoomKey(
      channel,
      enc({ roomId: 'r1', orgId: 'victim' })
    );
    expect(result).toEqual({
      ok: true,
      params: { roomId: 'r1' },
      topic: 'room/r1',
    });
  });

  it('keeps a legitimately-supplied optional slot (declared, not required)', () => {
    const channel = defineChannel('room/:roomId/:sub?')();
    const result = resolveRoomKey(channel, enc({ roomId: 'r1', sub: 'x' }));
    expect(result).toEqual({
      ok: true,
      params: { roomId: 'r1', sub: 'x' },
      topic: 'room/r1/x',
    });
  });

  it('the topic is unaffected by an undeclared key: identical to the topic computed without it', () => {
    const channel = defineChannel('room/:roomId')();
    const withExtra = resolveRoomKey(
      channel,
      enc({ roomId: 'r1', orgId: 'victim' })
    );
    const withoutExtra = resolveRoomKey(channel, enc({ roomId: 'r1' }));
    expect(withExtra.ok && withoutExtra.ok).toBe(true);
    if (withExtra.ok && withoutExtra.ok) {
      expect(withExtra.topic).toBe(withoutExtra.topic);
    }
  });

  // -------------------------------------------------------------------------
  // (security, P0) prototype-chain auth bypass: a channel keyed on a param
  // name that collides with an Object.prototype member (`toString`,
  // `constructor`, ...) is now rejected at DEFINITION time (isReservedParamName),
  // so the hazardous channel can never be constructed and no keyless-topic-leak
  // code path exists. This is the structural close of the class: a declared
  // reserved-name param cannot exist, so no guard on any tier can read one.
  // -------------------------------------------------------------------------

  it('(security) a channel keyed on a reserved (Object.prototype-member) param name cannot be defined', () => {
    expect(() => defineChannel('presence/:toString')()).toThrow(/reserved/);
    expect(() => defineChannel('presence/:constructor')()).toThrow(/reserved/);
    // A normal channel param name is unaffected.
    expect(() => defineChannel('presence/:roomId')()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // (shared-pipeline alignment) a present-but-non-object payload must deny on
  // BOTH the socket and room paths, even against a param-less pattern. Before
  // the `parseKeyParams` extraction, `resolveRoomKey` coerced a non-object
  // parse result (e.g. `r="hello"`, valid JSON, a string) to `{}` and only
  // failed if a required slot then ended up missing, so a param-less channel
  // resolved `ok: true` for a garbage payload. `resolveSocketParams` already
  // denied this case outright. Both now share the same fail-closed reading:
  // an unusable payload is a contract lie, not a missing param, regardless of
  // whether the pattern has any required slots.
  // -------------------------------------------------------------------------

  it('(security, aligned) a present-but-non-object payload denies even against a param-less channel', () => {
    const channel = defineChannel('lobby')();
    expect(resolveRoomKey(channel, enc('hello'))).toEqual({ ok: false });
    expect(resolveRoomKey(channel, enc(42))).toEqual({ ok: false });
    expect(resolveRoomKey(channel, enc([1, 2]))).toEqual({ ok: false });
  });
});
