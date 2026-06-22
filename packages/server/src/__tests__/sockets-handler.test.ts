import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  defineChannel,
  defineRoom,
  defineServerMiddleware,
  defineSocket,
  type SocketDef,
} from '@hono-preact/iso';
import type { RoomDef } from '@hono-preact/iso/internal';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  installRealtimeConnector,
  __resetRealtimeConnectorForTesting,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_ROOM_PARAM,
  SOCKETS_RPC_PATH,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal/runtime';
import {
  assertNoSocketRoomCollision,
  buildSocketRegistry,
  socketsHandler,
} from '../sockets-handler.js';
import { buildRoomRegistry } from '../rooms-handler.js';
import type {
  WebSocketUpgrader,
  RealtimeConnector,
  RoomConnectContext,
} from '@hono-preact/iso/internal/runtime';
import type { WSEvents } from 'hono/ws';

// ---------------------------------------------------------------------------
// Fake WebSocket upgrader
//
// The real upgrader (e.g. @hono/node-ws) runs an HTTP upgrade handshake.
// In tests we synchronously invoke `createEvents(ctx)` and return the
// captured WSEvents object so each test can drive ws events directly.
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

// A fake upgrader that captures WSEvents and returns a Hono MiddlewareHandler.
// It resolves the createEvents factory synchronously on the first request and
// exposes the events + ws so tests can drive them.
function makeFakeUpgrader(): {
  upgrader: WebSocketUpgrader;
  lastEvents: () => WSEvents;
  lastWs: () => FakeWs;
} {
  let capturedEvents: WSEvents | null = null;
  let capturedWs: FakeWs | null = null;

  const upgrader: WebSocketUpgrader = (createEvents) => {
    return async (c, _next) => {
      const ws = makeFakeWs();
      const events = await createEvents(c);
      capturedEvents = events;
      capturedWs = ws;
      return c.text('101', 101);
    };
  };

  return {
    upgrader,
    lastEvents: () => {
      if (!capturedEvents) throw new Error('no events captured yet');
      return capturedEvents;
    },
    lastWs: () => {
      if (!capturedWs) throw new Error('no ws captured yet');
      return capturedWs;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(
  registry: Map<string, SocketDef<unknown, unknown, unknown>>,
  appConfig?: Parameters<typeof socketsHandler>[0]['appConfig'],
  resolvePageUse?: Parameters<typeof socketsHandler>[0]['resolvePageUse'],
  resolveRoutePath?: Parameters<typeof socketsHandler>[0]['resolveRoutePath']
) {
  const app = new Hono();
  app.get(
    SOCKETS_RPC_PATH,
    socketsHandler({ registry, appConfig, resolvePageUse, resolveRoutePath })
  );
  return app;
}

function getRequest(m: string, s: string) {
  return app.request(
    `http://localhost${SOCKETS_RPC_PATH}?m=${encodeURIComponent(m)}&s=${encodeURIComponent(s)}`
  );
}

// We declare `app` in tests that need it; this top-level placeholder keeps TS
// happy for the helper above. Each test constructs its own app.
let app: Hono;

afterEach(() => {
  __resetWebSocketUpgraderForTesting();
  __resetRealtimeConnectorForTesting();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('socketsHandler: unknown socket closes WS_DENY_CODE', () => {
  it('closes 4403 when module key is unknown', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const registry = new Map<string, SocketDef<unknown, unknown, unknown>>();
    app = makeApp(registry);

    await getRequest('missing/module', 'chat');

    const events = lastEvents();
    const ws = lastWs();
    events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('closes 4403 when socket name is unknown on a known module', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'unknownSocket');

    const ws = lastWs();
    const events = lastEvents();
    events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });
});

describe('socketsHandler: known socket - open, send, message, close teardown', () => {
  it('calls def.open and socket.send JSON-stringifies the message', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openCalls: unknown[] = [];
    const def = defineSocket<{ text: string }, { reply: string }>({
      open(socket) {
        openCalls.push('opened');
        socket.send({ reply: 'hello' });
      },
    }) as unknown as SocketDef<{ text: string }, { reply: string }, undefined>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(openCalls).toEqual(['opened']);
    expect(ws.sends).toHaveLength(1);
    expect(ws.sends[0]).toBe(JSON.stringify({ reply: 'hello' }));
  });

  it('onMessage JSON-parses the raw string and calls def.message', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const received: unknown[] = [];
    const def = defineSocket<{ text: string }, never>({
      message(_socket, msg) {
        received.push(msg);
      },
    }) as unknown as SocketDef<{ text: string }, never, undefined>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    // Simulate open first so denied flag is not set
    await events.onOpen?.(new Event('open'), ws as never);

    const msgEvent = { data: JSON.stringify({ text: 'hi there' }) };
    await events.onMessage?.(msgEvent as MessageEvent, ws as never);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ text: 'hi there' });
  });

  it('onClose runs the teardown returned by def.open', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const calls: string[] = [];
    const def = defineSocket<never, never>({
      open() {
        calls.push('opened');
        return () => {
          calls.push('teardown');
        };
      },
      close() {
        calls.push('closed');
      },
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    events.onClose?.({ code: 1000, reason: '' } as CloseEvent, ws as never);

    expect(calls).toEqual(['opened', 'teardown', 'closed']);
  });
});

describe('socketsHandler: guard denial closes WS_DENY_CODE without calling def.open', () => {
  it('a denying server middleware closes 4403 and skips def.open', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      use: [
        defineServerMiddleware(async (_ctx) => {
          const { deny } = await import('@hono-preact/iso');
          throw deny('forbidden', 403);
        }),
      ],
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('socketsHandler: route-node use inheritance via resolvePageUse', () => {
  it('a denying route-node use closes WS_DENY_CODE without calling def.open', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const moduleKey = 'pages/chat';
    const routePath = '/chat';
    const registry = new Map([[`${moduleKey}::chatSocket`, def]]);

    // Route-node use: denies all connections on /chat.
    const denyMiddleware = defineServerMiddleware(async (_ctx) => {
      const { deny } = await import('@hono-preact/iso');
      throw deny('forbidden', 403);
    });
    const resolvePageUse = (path: string) =>
      path === routePath ? [denyMiddleware] : [];
    const resolveRoutePath = (mk: string) =>
      mk === moduleKey ? routePath : undefined;

    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);
    await getRequest(moduleKey, 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('an allowing route-node use lets def.open run', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const moduleKey = 'pages/chat';
    const routePath = '/chat';
    const registry = new Map([[`${moduleKey}::chatSocket`, def]]);

    // Route-node use: allows all connections (pass-through middleware).
    const allowMiddleware = defineServerMiddleware(async (_ctx, next) => {
      await next();
    });
    const resolvePageUse = (path: string) =>
      path === routePath ? [allowMiddleware] : [];
    const resolveRoutePath = (mk: string) =>
      mk === moduleKey ? routePath : undefined;

    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);
    await getRequest(moduleKey, 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledOnce();
  });

  it('a socket with unknown moduleKey gets no route-node use (app-use + def-use only)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const moduleKey = 'pages/chat';
    const registry = new Map([[`${moduleKey}::chatSocket`, def]]);

    // resolveRoutePath does not know this moduleKey; falls back to SOCKETS_RPC_PATH.
    // resolvePageUse only guards a different path; bare socket path has no guards.
    const resolvePageUse = (path: string) =>
      path === '/chat'
        ? [
            defineServerMiddleware(async (_ctx) => {
              const { deny } = await import('@hono-preact/iso');
              throw deny('no', 403);
            }),
          ]
        : [];
    const resolveRoutePath = (_mk: string): string | undefined => undefined;

    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);
    await getRequest(moduleKey, 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    // No route-node deny guard applied because resolveRoutePath returned undefined;
    // the fallback SOCKETS_RPC_PATH matches no route pattern.
    expect(ws.closes).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledOnce();
  });
});

describe('buildSocketRegistry', () => {
  it('keys entries as moduleKey::name from serverSockets', async () => {
    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: 'pages/chat',
          serverSockets: { chatSocket: def },
        }),
    ];

    const registry = await buildSocketRegistry(serverImports);

    expect(registry.has('pages/chat::chatSocket')).toBe(true);
    expect(registry.get('pages/chat::chatSocket')).toBe(def);
  });

  it('skips modules that lack __moduleKey', async () => {
    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const serverImports = [
      () =>
        Promise.resolve({
          serverSockets: { chatSocket: def },
        }),
    ];

    const registry = await buildSocketRegistry(serverImports);

    expect(registry.size).toBe(0);
  });
});

describe('assertNoSocketRoomCollision', () => {
  it('throws a descriptive error when a socket and a room share a moduleKey::name key', async () => {
    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const channel = defineChannel('thing/:id')<void>();
    const room = defineRoom(channel, {}) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;

    // A single module exports BOTH serverSockets.foo and serverRooms.foo: the
    // two registries collide on `pages/m::foo`.
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: 'pages/m',
          serverSockets: { foo: def },
          serverRooms: { foo: room },
        }),
    ];
    const registry = await buildSocketRegistry(serverImports);
    const rooms = await buildRoomRegistry(serverImports);

    expect(() => assertNoSocketRoomCollision(registry, rooms)).toThrow(
      /pages\/m::foo/
    );
    expect(() => assertNoSocketRoomCollision(registry, rooms)).toThrow(
      /socket .* and a room .* cannot share a name/i
    );
  });

  it('does not throw when socket and room names are distinct in a module', async () => {
    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const channel = defineChannel('thing/:id')<void>();
    const room = defineRoom(channel, {}) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    const serverImports = [
      () =>
        Promise.resolve({
          __moduleKey: 'pages/m',
          serverSockets: { chatSocket: def },
          serverRooms: { boardRoom: room },
        }),
    ];
    const registry = await buildSocketRegistry(serverImports);
    const rooms = await buildRoomRegistry(serverImports);

    expect(() => assertNoSocketRoomCollision(registry, rooms)).not.toThrow();
  });

  it('is a no-op when there is no room registry', () => {
    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const registry = new Map([['pages/m::foo', def]]);
    expect(() =>
      assertNoSocketRoomCollision(registry, undefined)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Realtime connector seam (PR 5a Task 4)
//
// With a connector installed (the Cloudflare adapter installs one), an ALLOWED
// room connection is forwarded to the connector (which on CF forwards the
// upgrade to a Durable Object) instead of running the room runtime in the
// worker. The guard chain runs at the edge BEFORE any forward: a denied room
// and a plain socket never reach the connector.
// ---------------------------------------------------------------------------

describe('socketsHandler: realtime connector forwarding', () => {
  const ROOM_MODULE = 'pages/board';
  const ROOM_NAME = 'boardRoom';
  const roomChannel = defineChannel('room/:roomId')<{ text: string }>();

  // A fake connector that records its calls and returns a sentinel Response.
  function makeFakeConnector(): {
    connector: RealtimeConnector;
    calls: () => RoomConnectContext[];
    response: Response;
  } {
    const calls: RoomConnectContext[] = [];
    // A sentinel Response standing in for the forwarded upgrade. The real CF
    // upgrade Response is { status: 101, webSocket }, but the WHATWG Response
    // constructor outside workerd rejects status 101, so the sentinel uses a
    // plain 200: the test asserts identity (the handler returns THIS Response),
    // not the status code.
    const response = new Response('forwarded-to-DO');
    const connector: RealtimeConnector = (ctx) => {
      calls.push(ctx);
      return response;
    };
    return { connector, calls: () => calls, response };
  }

  // A room app whose `/__sockets` route returns the handler's value directly so
  // the connector's Response can be asserted on. The connector returns a
  // Response, so the handler returns it directly (NOT through the upgrader).
  function makeRoomApp(
    roomHandler: Parameters<typeof defineRoom>[1],
    resolvePageUse?: Parameters<typeof socketsHandler>[0]['resolvePageUse'],
    resolveRoutePath?: Parameters<typeof socketsHandler>[0]['resolveRoutePath']
  ): Hono {
    const room = defineRoom(roomChannel, roomHandler) as unknown as RoomDef<
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    const rooms = new Map([[`${ROOM_MODULE}::${ROOM_NAME}`, room]]);
    const honoApp = new Hono();
    honoApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry: new Map(),
        rooms,
        resolvePageUse,
        resolveRoutePath,
      })
    );
    return honoApp;
  }

  function connectRoom(honoApp: Hono, rawR: string): Promise<Response> {
    return honoApp.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(ROOM_MODULE)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_ROOM_PARAM}=${encodeURIComponent(rawR)}`
    );
  }

  it('forwards an ALLOWED room to the connector exactly once with the resolved context', async () => {
    const { connector, calls, response } = makeFakeConnector();
    installRealtimeConnector(connector);
    // The upgrader must NOT be consulted on the allowed-room forward path; install
    // one that throws so a stray upgrade() call would fail the test loudly.
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the forward path');
    });

    const app = makeRoomApp({
      // The data factory runs at the edge with the live Context.
      data: (c) => ({ tag: c.req.query('tag') ?? 'none' }),
    });

    const res = await app.request(
      `http://localhost${SOCKETS_RPC_PATH}` +
        `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(ROOM_MODULE)}` +
        `&${SOCKET_NAME_PARAM}=${encodeURIComponent(ROOM_NAME)}` +
        `&${SOCKET_ROOM_PARAM}=${encodeURIComponent(JSON.stringify({ roomId: 'demo' }))}` +
        `&tag=x`
    );

    // The handler returns the connector's Response directly.
    expect(res).toBe(response);
    expect(await res.text()).toBe('forwarded-to-DO');

    // The connector was called exactly once with the fully-resolved context.
    expect(calls()).toHaveLength(1);
    const ctx = calls()[0]!;
    expect(ctx.topic).toBe('room/demo'); // server-interpolated, not client-supplied
    expect(ctx.moduleKey).toBe(ROOM_MODULE);
    expect(ctx.name).toBe(ROOM_NAME);
    expect(ctx.params).toEqual({ roomId: 'demo' });
    // data is the already-run roomDef.data(c) result captured at the edge.
    expect(ctx.data).toEqual({ tag: 'x' });
  });

  it('does NOT forward a DENIED room: the in-worker deny path closes WS_DENY_CODE', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);

    // The in-worker deny path goes through the upgrader (createRoomWsEvents whose
    // onOpen closes 4403). Capture the events so we can drive onOpen.
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const app = makeRoomApp({
      use: [
        defineServerMiddleware(async () => {
          const { deny } = await import('@hono-preact/iso');
          throw deny('forbidden', 403);
        }),
      ],
    });

    await connectRoom(app, JSON.stringify({ roomId: 'demo' }));

    // The connector was never called: the guard denied BEFORE any forward.
    expect(calls()).toHaveLength(0);

    // The in-worker deny path closes WS_DENY_CODE in onOpen.
    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('does NOT forward a room whose key fails to resolve (in-worker deny path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const app = makeRoomApp({});

    // A required `:roomId` param is missing: resolveRoomKey returns { ok: false }.
    await connectRoom(app, JSON.stringify({}));

    // A connection whose topic/params never resolved must not be forwarded.
    expect(calls()).toHaveLength(0);

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
  });

  it('never forwards a plain socket: it uses the in-worker socket path', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;
    const registry = new Map([['pages/chat::chatSocket', def]]);

    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    // A plain socket is never forwarded to the connector.
    expect(calls()).toHaveLength(0);

    // It runs the in-worker socket path (def.open fires on open).
    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(openSpy).toHaveBeenCalledOnce();
  });

  it('passes the resolved room-key params to a route-node guard before forwarding', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the forward path');
    });

    let seenRoomIdInGuard: string | undefined;
    const requireRoomId = defineServerMiddleware(async (mwCtx, next) => {
      seenRoomIdInGuard = mwCtx.location.pathParams.roomId;
      await next();
    });

    const app = makeRoomApp(
      {},
      (path: string) => (path === '/board' ? [requireRoomId] : []),
      (mk: string) => (mk === ROOM_MODULE ? '/board' : undefined)
    );

    await connectRoom(app, JSON.stringify({ roomId: 'demo' }));

    // The guard saw the room-key param (params reach the guard at the edge), then
    // allowed, then the connection was forwarded.
    expect(seenRoomIdInGuard).toBe('demo');
    expect(calls()).toHaveLength(1);
  });
});
