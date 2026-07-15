import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  defineChannel,
  defineRoom,
  defineServerMiddleware,
  defineSocket,
  type SocketDef,
} from '@hono-preact/iso';
import {
  _defineRouteSocket,
  _defineRouteRoom,
  type RoomDef,
} from '@hono-preact/iso/internal';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  installRealtimeConnector,
  __resetRealtimeConnectorForTesting,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_KEY_PARAM,
  SOCKETS_RPC_PATH,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal/runtime';
import {
  assertNoSocketRoomCollision,
  buildSocketRegistry,
  socketsHandler,
} from '../sockets-handler.js';
import { MAX_FORWARD_HEADER_BYTES } from '../realtime-budget.js';
import { buildRoomRegistry } from '../rooms-handler.js';
import type {
  WebSocketUpgrader,
  RealtimeConnector,
  RealtimeConnectContext,
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
    socketsHandler({
      registry,
      appConfig,
      resolvePageUse: resolvePageUse ?? (() => []),
      resolveRoutePath,
    })
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

  it('runs def.data(c) at the edge and seeds socket.data (Node parity)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const seen: string[] = [];
    const def = defineSocket<{ ping: true }, { who: string }, { who: string }>({
      data: (c) => ({ who: c.req.query('u') ?? 'anon' }),
      open(socket) {
        // open no longer receives a Context; it reads the data factory result.
        socket.send({ who: socket.data.who });
      },
      message(socket) {
        seen.push(socket.data.who);
      },
    }) as unknown as SocketDef<
      { ping: true },
      { who: string },
      { who: string }
    >;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    // getRequest has no query hook, so issue the request inline with `?u=alice`.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket&u=alice`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.sends[0]).toBe(JSON.stringify({ who: 'alice' }));

    await events.onMessage?.(
      { data: JSON.stringify({ ping: true }) } as MessageEvent,
      ws as never
    );
    expect(seen).toEqual(['alice']);
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

describe('socketsHandler: Node robustness + deny parity (max-review fixes)', () => {
  it('drops a malformed (non-JSON) frame instead of throwing', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const received: unknown[] = [];
    const def = defineSocket<{ ok: true }, never>({
      message(_s, msg) {
        received.push(msg);
      },
    }) as unknown as SocketDef<{ ok: true }, never, undefined>;

    app = makeApp(new Map([['pages/chat::chatSocket', def]]));
    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    // A non-JSON frame must not throw and must not call message.
    await expect(
      events.onMessage?.({ data: 'not json{' } as MessageEvent, ws as never)
    ).resolves.toBeUndefined();
    expect(received).toEqual([]);

    // A subsequent valid frame still works.
    await events.onMessage?.(
      { data: JSON.stringify({ ok: true }) } as MessageEvent,
      ws as never
    );
    expect(received).toEqual([{ ok: true }]);
  });

  it('a denied connection runs none of data()/open()/close()/error()', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const calls: string[] = [];
    const def = defineSocket<never, never>({
      use: [
        defineServerMiddleware(async (_ctx) => {
          const { deny } = await import('@hono-preact/iso');
          throw deny('forbidden', 403);
        }),
      ],
      data: () => {
        calls.push('data');
        return {};
      },
      open: () => {
        calls.push('open');
      },
      close: () => {
        calls.push('close');
      },
      error: () => {
        calls.push('error');
      },
    }) as unknown as SocketDef<never, never, undefined>;

    app = makeApp(new Map([['pages/chat::chatSocket', def]]));
    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    events.onClose?.(
      { code: WS_DENY_CODE, reason: 'forbidden' } as CloseEvent,
      ws as never
    );
    events.onError?.(new Event('error'), ws as never);

    expect(ws.closes[0]?.code).toBe(WS_DENY_CODE);
    // Parity with Cloudflare, where a denied socket never reaches the DO: none
    // of the user callbacks run for a denied connection.
    expect(calls).toEqual([]);
  });

  it('seeds socket.data from an async data() factory before message runs', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const seen: string[] = [];
    const def = defineSocket<{ ping: true }, never, { who: string }>({
      data: async (c) => ({ who: c.req.query('u') ?? 'anon' }),
      message(socket) {
        seen.push(socket.data.who);
      },
    }) as unknown as SocketDef<{ ping: true }, never, { who: string }>;

    app = makeApp(new Map([['pages/chat::chatSocket', def]]));
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket&u=alice`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    await events.onMessage?.(
      { data: JSON.stringify({ ping: true }) } as MessageEvent,
      ws as never
    );
    expect(seen).toEqual(['alice']);
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

  it('a guard returning redirect() still fails closed (WS_DENY_CODE) but warns about the divergence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = defineSocket<never, never>({
      use: [
        defineServerMiddleware(async (_ctx) => {
          const { redirect } = await import('@hono-preact/iso');
          throw redirect('/login');
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

    // A WebSocket handshake cannot follow an HTTP redirect, so failing closed
    // is the only correct option (parity with the deny case above).
    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
    // But the silent reinterpretation of redirect-as-deny is surfaced so a
    // consumer reusing an HTTP auth guard on a socket can diagnose it.
    expect(warn.mock.calls.some((c) => /redirect/i.test(String(c[0])))).toBe(
      true
    );

    warn.mockRestore();
  });
});

describe('socketsHandler: fail-closed at construction', () => {
  it('throws when resolvePageUse is omitted (auth-bypass guard)', () => {
    // page-level `use` carries route/layout auth gates; an absent resolver
    // would silently drop them on the socket-upgrade path. Mirrors the
    // loadersHandler / pageActionsHandler construction guards.
    expect(() =>
      socketsHandler({
        registry: new Map<string, SocketDef<unknown, unknown, unknown>>(),
      })
    ).toThrow(/resolvePageUse/);
  });

  it('throws when resolvePageUse is not a function', () => {
    expect(() =>
      socketsHandler({
        registry: new Map<string, SocketDef<unknown, unknown, unknown>>(),
        resolvePageUse: {} as never,
      })
    ).toThrow(/resolvePageUse/);
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
    calls: () => RealtimeConnectContext[];
    response: Response;
  } {
    const calls: RealtimeConnectContext[] = [];
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
        resolvePageUse: resolvePageUse ?? (() => []),
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
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(rawR)}`
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
        `&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({ roomId: 'demo' }))}` +
        `&tag=x`
    );

    // The handler returns the connector's Response directly.
    expect(res).toBe(response);
    expect(await res.text()).toBe('forwarded-to-DO');

    // The connector was called exactly once with the fully-resolved forward
    // context.
    expect(calls()).toHaveLength(1);
    const ctx = calls()[0]!;
    expect(ctx.kind).toBe('forward');
    if (ctx.kind !== 'forward') throw new Error('expected forward kind');
    expect(ctx.topic).toBe('room/demo'); // server-interpolated, not client-supplied
    expect(ctx.moduleKey).toBe(ROOM_MODULE);
    expect(ctx.name).toBe(ROOM_NAME);
    expect(ctx.params).toEqual({ roomId: 'demo' });
    // data is the already-run roomDef.data(c) result captured at the edge.
    expect(ctx.data).toEqual({ tag: 'x' });
  });

  it('routes a DENIED room to the connector with kind:deny (NOT the forward path, NOT the upgrader)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);

    // The deny close runs in the connector (a transport-native upgrade-and-close
    // on workerd), NOT through the in-worker upgrader. Install one that throws so
    // a stray upgrade() call (e.g. the pre-fix getWebSocketUpgrader fall-through
    // that crashed the worker on CF) fails the test loudly.
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the room deny path');
    });

    const app = makeRoomApp({
      use: [
        defineServerMiddleware(async () => {
          const { deny } = await import('@hono-preact/iso');
          throw deny('forbidden', 403);
        }),
      ],
    });

    await connectRoom(app, JSON.stringify({ roomId: 'demo' }));

    // The connector was called exactly once with kind:deny: the guard denied
    // (BEFORE any forward), so the connector NEVER receives a forward context for
    // a denied connection and the DO is never contacted.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.kind).toBe('deny');
  });

  it('routes a room whose key fails to resolve to the connector with kind:deny', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the room deny path');
    });

    const app = makeRoomApp({});

    // A required `:roomId` param is missing: resolveRoomKey returns { ok: false }.
    await connectRoom(app, JSON.stringify({}));

    // A connection whose topic/params never resolved is routed to the connector
    // as a deny (closed WS_DENY_CODE), not forwarded.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.kind).toBe('deny');
  });

  it('forwards a plain socket through the connector as socket-forward (CF path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);

    const def = defineSocket<
      { text: string },
      { reply: string },
      { who: string }
    >({
      data: (c) => ({ who: c.req.query('u') ?? 'anon' }),
    }) as unknown as SocketDef<
      { text: string },
      { reply: string },
      { who: string }
    >;
    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    const res = await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket&u=alice`
    );
    // The handler returns the connector's Response identity (the sentinel).
    expect(await res.text()).toBe('forwarded-to-DO');

    const recorded = calls();
    expect(recorded).toHaveLength(1);
    const fwd = recorded[0]!;
    expect(fwd.kind).toBe('socket-forward');
    if (fwd.kind === 'socket-forward') {
      expect(fwd.moduleKey).toBe('pages/chat');
      expect(fwd.name).toBe('chatSocket');
      expect(fwd.data).toEqual({ who: 'alice' });
    }
  });

  it('forwards a BOUND socket through the connector with the RESOLVED route params (CF path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    // The upgrader must NOT be consulted on the forward path; install one that
    // throws so a stray upgrade() call would fail the test loudly.
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the forward path');
    });

    const def = _defineRouteSocket<
      never,
      never,
      Record<string, string>,
      Record<string, string>
    >('/board/:id', {
      data: (_c, params) => params,
    }) as unknown as SocketDef<never, never, Record<string, string>>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    app = makeApp(registry);

    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({ id: 'b1' }))}`
    );

    // This pins that the CF path threads the RESOLVED r= params into the data
    // factory, not `{}`: a future edit that forwards the wrong (or no) params
    // to the factory would break this while the Node-path test above stays
    // green.
    const recorded = calls();
    expect(recorded).toHaveLength(1);
    const fwd = recorded[0]!;
    expect(fwd.kind).toBe('socket-forward');
    if (fwd.kind === 'socket-forward') {
      expect(fwd.data).toEqual({ id: 'b1' });
    }
  });

  it('denies a BOUND socket with no r= query via the connector deny, before any DO contact (CF path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    // A missing required param must deny BEFORE any connector forward; install
    // an upgrader that throws so a stray upgrade() call fails the test loudly.
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the socket deny path');
    });

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/board/:id', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    app = makeApp(registry);

    // No SOCKET_KEY_PARAM (r=) on the request.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket`
    );

    // The connector was called exactly once with kind:deny: the missing
    // required param denies at the edge, so the connector never receives a
    // socket-forward context and the DO is never contacted.
    const recorded = calls();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.kind).toBe('deny');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a denied plain socket closes via the connector deny, never the upgrader (CF path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    // No upgrader is installed: a fall-through to getWebSocketUpgrader() would
    // throw. A clean deny via the connector proves the CF path never touches it.
    const def = defineSocket<never, never>({
      use: [
        defineServerMiddleware(async () => {
          const { deny } = await import('@hono-preact/iso');
          throw deny('forbidden', 403);
        }),
      ],
    }) as unknown as SocketDef<never, never, undefined>;
    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket`
    );
    const recorded = calls();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.kind).toBe('deny');
  });

  it('an unknown def on the CF path denies via the connector (no upgrader)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    app = makeApp(new Map()); // empty registry: unknown def
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=missing/module&s=nope`
    );
    const recorded = calls();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.kind).toBe('deny');
  });

  it('guard runs EXACTLY ONCE on a DENIED CF connection (no double-invoke)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the room deny path');
    });

    // Counting guard: each invocation increments the counter.
    let guardRunCount = 0;
    const countingDenyGuard = defineServerMiddleware(async () => {
      guardRunCount++;
      const { deny } = await import('@hono-preact/iso');
      throw deny('forbidden', 403);
    });

    const app = makeRoomApp({ use: [countingDenyGuard] });

    await connectRoom(app, JSON.stringify({ roomId: 'demo' }));

    // The guard must run exactly once: the CF deny path must reuse the
    // already-resolved connection rather than re-running resolveConnection.
    expect(guardRunCount).toBe(1);

    // The connector handled the deny exactly once (kind:deny), so the DO is
    // never contacted for a denied connection.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.kind).toBe('deny');
  });

  it('guard runs EXACTLY ONCE on an ALLOWED CF connection (forward path)', async () => {
    const { connector, calls } = makeFakeConnector();
    installRealtimeConnector(connector);
    installWebSocketUpgrader(() => () => {
      throw new Error('upgrader must not run on the forward path');
    });

    let guardRunCount = 0;
    const countingAllowGuard = defineServerMiddleware(async (_ctx, next) => {
      guardRunCount++;
      await next();
    });

    const app = makeRoomApp({ use: [countingAllowGuard] });

    await connectRoom(app, JSON.stringify({ roomId: 'demo' }));

    // The guard must run exactly once on the allow (forward) path too.
    expect(guardRunCount).toBe(1);
    expect(calls()).toHaveLength(1);
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

  it('the connector context union includes a socket-forward variant', () => {
    const { connector, calls } = makeFakeConnector();
    // A socket-forward context is assignable to the connector parameter (the new
    // union member) and is recorded with its discriminant + fields. The fake
    // connector never reads `c`, so a sanctioned single test cast stands in for
    // the live Context the real edge path supplies in Task 7.
    void connector({
      c: undefined as never,
      kind: 'socket-forward',
      moduleKey: 'pages/chat',
      name: 'chatSocket',
      data: { who: 'alice' },
    });
    const recorded = calls();
    expect(recorded[0]?.kind).toBe('socket-forward');
  });
});

// ---------------------------------------------------------------------------
// FIX 3: dev budget warning threads through socketsHandler -> warnIfOverForwardBudget
//
// These tests use the socket path (plain duplex socket, no room registry) because
// the socket branch calls warnIfOverForwardBudget directly in createEvents before
// returning WSEvents, making it straightforward to drive with the existing fake
// upgrader harness. The helper is shared with the room path, so one path proves
// the threading.
// ---------------------------------------------------------------------------

describe('socketsHandler: dev budget warning threads through to warnIfOverForwardBudget', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns when dev=true and the data factory result is over budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = defineSocket<never, never, { blob: string }>({
      data: () => ({ blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) }),
    }) as unknown as SocketDef<never, never, { blob: string }>;

    const testApp = new Hono();
    testApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry: new Map([['pages/chat::chatSocket', def]]),
        resolvePageUse: () => [],
        dev: true,
      })
    );

    // warnIfOverForwardBudget fires during createEvents (the upgrade request),
    // before onOpen; asserting after app.request is sufficient.
    await testApp.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket`
    );

    expect(warn).toHaveBeenCalled();
    expect(
      warn.mock.calls.some((c) => /forward limit/i.test(String(c[0])))
    ).toBe(true);

    // Drive open to confirm the connection is otherwise healthy.
    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes).toHaveLength(0);
  });

  it('does not warn when dev=false even with an over-budget data factory', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = defineSocket<never, never, { blob: string }>({
      data: () => ({ blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) }),
    }) as unknown as SocketDef<never, never, { blob: string }>;

    const testApp = new Hono();
    testApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry: new Map([['pages/chat::chatSocket', def]]),
        resolvePageUse: () => [],
        dev: false,
      })
    );

    await testApp.request(
      `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket`
    );

    // No forward-limit warning must fire when dev is false.
    expect(
      warn.mock.calls.some((c) => /forward limit/i.test(String(c[0])))
    ).toBe(false);

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes).toHaveLength(0);
  });
});

describe('socketsHandler: declared route binding (serverRoute(r).socket/.room)', () => {
  const denyMiddleware = defineServerMiddleware(async (_ctx) => {
    const { deny } = await import('@hono-preact/iso');
    throw deny('forbidden', 403);
  });

  it('a registry-module socket bound to a guarded route runs that route gates (attacker model)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/admin', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    // Registry module: not in the route tree, so the mount derivation yields
    // undefined. Before this fix the connection resolved SOCKETS_RPC_PATH and
    // ran NO page gates; the declared '/admin' binding must select them.
    const resolvePageUse = (path: string) =>
      path === '/admin' ? [denyMiddleware] : [];

    const registry = new Map([['src/server/rt::feed', def]]);
    app = makeApp(registry, undefined, resolvePageUse, () => undefined);
    await getRequest('src/server/rt', 'feed');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a registry-module room bound to a guarded route runs that route gates (attacker model)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const onJoinSpy = vi.fn();
    const channel = defineChannel('board/:boardId')<{ n: number }>();
    const def = _defineRouteRoom('/admin', channel, {
      onJoin: onJoinSpy,
    }) as unknown as RoomDef<unknown, unknown, unknown, unknown, unknown>;

    const resolvePageUse = (path: string) =>
      path === '/admin' ? [denyMiddleware] : [];

    const localApp = new Hono();
    localApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry: new Map(),
        rooms: new Map([['src/server/rt::board', def]]),
        resolvePageUse,
        resolveRoutePath: () => undefined,
      })
    );
    // A valid room-key param is required so the connection is denied by the
    // guard (the thing under test), not by a failed room-key resolution (which
    // also closes WS_DENY_CODE but proves nothing about route precedence).
    await localApp.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('src/server/rt')}&${SOCKET_NAME_PARAM}=board&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({ boardId: 'demo' }))}`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
  });

  it('the declared pattern wins over the mount derivation (subtree spelling)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/admin/*', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const resolved: string[] = [];
    const resolvePageUse = (path: string) => {
      resolved.push(path);
      return [];
    };

    // The mount derivation says '/admin' (the exact page scope); the declared
    // subtree spelling must win. This is the one route-attached case where the
    // two chains observably differ (the boot guard forces exact declarations
    // to equal the mount).
    const registry = new Map([['pages/admin::feed', def]]);
    app = makeApp(registry, undefined, resolvePageUse, () => '/admin');
    await getRequest('pages/admin', 'feed');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(resolved).toEqual(['/admin/*']);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(ws.closes).toHaveLength(0);
  });

  it('bare defs keep the mount derivation and the SOCKETS_RPC_PATH fallback', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const resolved: string[] = [];
    const resolvePageUse = (path: string) => {
      resolved.push(path);
      return [];
    };

    // Mounted module: bare defs still resolve via the mount.
    app = makeApp(
      new Map([['pages/chat::feed', def]]),
      undefined,
      resolvePageUse,
      (mk) => (mk === 'pages/chat' ? '/chat' : undefined)
    );
    await getRequest('pages/chat', 'feed');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);
    expect(resolved).toEqual(['/chat']);

    // Route-less registry module: terminal fallback unchanged.
    resolved.length = 0;
    app = makeApp(
      new Map([['src/server/rt::feed', def]]),
      undefined,
      resolvePageUse,
      () => undefined
    );
    await getRequest('src/server/rt', 'feed');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);
    expect(resolved).toEqual([SOCKETS_RPC_PATH]);
  });
});

describe('socketsHandler: bound socket param resolution (serverRoute(r).socket)', () => {
  it('resolves route params from the r= wire and feeds them to the guard and the data factory, dropping an undeclared key', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let guardSeenParams: Record<string, string> | undefined;
    const captureGuard = defineServerMiddleware(async (mwCtx, next) => {
      guardSeenParams = mwCtx.location.pathParams;
      await next();
    });

    const openSpy = vi.fn();
    const def = _defineRouteSocket<
      never,
      never,
      Record<string, string>,
      Record<string, string>
    >('/board/:id', {
      data: (_c, params) => params,
      open(socket) {
        openSpy(socket.data);
      },
    }) as unknown as SocketDef<never, never, Record<string, string>>;

    const resolvePageUse = (path: string) =>
      path === '/board/:id' ? [captureGuard] : [];
    const registry = new Map([['pages/board::boardSocket', def]]);
    app = makeApp(registry, undefined, resolvePageUse, () => undefined);

    // The wire also carries `orgId`, a key the pattern `/board/:id` never
    // declares. No real HTTP request could ever produce it (Hono only
    // populates declared slots), so the resolver must drop it before it
    // reaches either the guard's `pathParams` or the `data` edge factory.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({ id: 'b1', orgId: 'victim' }))}`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(0);
    expect(guardSeenParams).toEqual({ id: 'b1' });
    expect(guardSeenParams?.orgId).toBeUndefined();
    expect(openSpy).toHaveBeenCalledWith({ id: 'b1' });
  });

  it('denies 4403 when the r= wire omits a required route param', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/board/:id', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    app = makeApp(
      registry,
      undefined,
      () => [],
      () => undefined
    );

    // No r= param on the request.
    await getRequest('pages/board', 'boardSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('warns naming the missing slot in dev mode when a required param is absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = _defineRouteSocket<never, never>(
      '/board/:id',
      {}
    ) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    const testApp = new Hono();
    testApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry,
        resolvePageUse: () => [],
        resolveRoutePath: () => undefined,
        dev: true,
      })
    );

    await testApp.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(warn.mock.calls.some((c) => /\bid\b/.test(String(c[0])))).toBe(true);

    warn.mockRestore();
  });

  it('a colocated socket (no __routeId) is never denied for a missing param and keeps pathParams: {}', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let guardSeenParams: Record<string, string> | undefined;
    const captureGuard = defineServerMiddleware(async (mwCtx, next) => {
      guardSeenParams = mwCtx.location.pathParams;
      await next();
    });

    const openSpy = vi.fn();
    // A bare defineSocket (no __routeId), colocated with a param-bearing route
    // file. The mount-derived routePath is param-bearing ('/board/:id'), but
    // gating must be on __routeId (absent here), NOT on the mounted pattern
    // having params: a colocated socket's client stub cannot be typed to send
    // params, so it must never be denied for a "missing" one.
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    const resolvePageUse = (path: string) =>
      path === '/board/:id' ? [captureGuard] : [];
    const resolveRoutePath = (mk: string) =>
      mk === 'pages/board' ? '/board/:id' : undefined;
    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);

    // No r= param at all.
    await getRequest('pages/board', 'boardSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(guardSeenParams).toEqual({});
  });

  it('a colocated socket ignores a malicious r= wire entirely and keeps pathParams: {}', async () => {
    // Adversarial variant of the test above: rather than omitting r=, a
    // client sends one, trying to smuggle a param value into a colocated
    // socket's guard. Colocated (unbound) resolution must never read r= at
    // all -- pinning the round-3 hole class (an unbound socket/room
    // resolving CLIENT-SUPPLIED params) from the opposite direction of the
    // "no r=" test.
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let guardSeenParams: Record<string, string> | undefined;
    const captureGuard = defineServerMiddleware(async (mwCtx, next) => {
      guardSeenParams = mwCtx.location.pathParams;
      await next();
    });

    const openSpy = vi.fn();
    // A bare defineSocket (no __routeId), colocated with a param-bearing
    // route file, exactly as the "no r=" test above.
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/board::boardSocket', def]]);
    const resolvePageUse = (path: string) =>
      path === '/board/:id' ? [captureGuard] : [];
    const resolveRoutePath = (mk: string) =>
      mk === 'pages/board' ? '/board/:id' : undefined;
    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);

    // A malicious r= wire, as if forged to smuggle an authorized-looking id.
    await app.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify({ id: 'pwn' }))}`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(guardSeenParams).toEqual({});
  });

  it('a colocated socket on /plugin/:constructor DENIES when a guard reads pathParams.constructor (prototype-chain bypass)', async () => {
    // The param-name grammar admits every Object.prototype member name
    // (constructor, toString, valueOf, hasOwnProperty, ...). A colocated
    // socket's guard params previously fell back to a plain `{}` object
    // literal, which inherits Object.prototype: a guard reading
    // `pathParams.constructor` for a route mounted at '/plugin/:constructor'
    // would resolve the INHERITED (truthy) Object constructor function
    // instead of `undefined`, so `if (!id) deny()` wrongly PASSES. This test
    // pins the fix: the params object must have no prototype at all, so the
    // read resolves to `undefined` and the guard denies.
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let observedId: unknown;
    const requireId = defineServerMiddleware(async (mwCtx, next) => {
      const id = mwCtx.location.pathParams.constructor;
      observedId = id;
      if (!id) {
        const { deny } = await import('@hono-preact/iso');
        throw deny('missing id', 403);
      }
      await next();
    });

    const openSpy = vi.fn();
    // Colocated (bare defineSocket, no __routeId) mounted under a route whose
    // own pattern happens to be '/plugin/:constructor'.
    const def = defineSocket<never, never>({
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/plugin::feed', def]]);
    const resolvePageUse = (path: string) =>
      path === '/plugin/:constructor' ? [requireId] : [];
    const resolveRoutePath = (mk: string) =>
      mk === 'pages/plugin' ? '/plugin/:constructor' : undefined;
    app = makeApp(registry, undefined, resolvePageUse, resolveRoutePath);

    await getRequest('pages/plugin', 'feed');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(observedId).toBeUndefined();
    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a failed room-key resolution hands the guard a null-proto pathParams object', async () => {
    // roomKey.ok is false (no r= wire, and the channel has a required :id
    // slot), so resolveGuardDenied falls back to the EMPTY params object.
    // That fallback must be prototype-less like every other params object,
    // not a plain `{}`.
    const { upgrader } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let observedParams: Record<string, string> | undefined;
    const captureGuard = defineServerMiddleware(async (mwCtx, next) => {
      observedParams = mwCtx.location.pathParams;
      await next();
    });

    const channel = defineChannel('room/:id')<unknown>();
    const roomDef = _defineRouteRoom(
      '/room/:id',
      channel,
      {}
    ) as unknown as RoomDef<unknown, unknown, unknown, unknown, unknown>;

    const registry = new Map<string, SocketDef<unknown, unknown, unknown>>();
    const rooms = new Map([['pages/room::feed', roomDef]]);
    const app2 = new Hono();
    app2.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry,
        rooms,
        resolvePageUse: (path) => (path === '/room/:id' ? [captureGuard] : []),
      })
    );

    // No r= param, so resolveRoomKey fails (missing required :id).
    await app2.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/room')}&${SOCKET_NAME_PARAM}=feed`
    );

    expect(observedParams).toBeDefined();
    expect(Object.getPrototypeOf(observedParams)).toBeNull();
  });

  it('a denied bound socket (missing required param) resolves a null-proto params object', async () => {
    // The early-return deny path (missing required :id on a route-bound
    // socket) never runs the guard, but the resolved connection's own
    // `params` field must still be prototype-less for any downstream reader.
    const def = _defineRouteSocket<never, never>(
      '/board/:id',
      {}
    ) as unknown as SocketDef<never, never, undefined>;
    const registry = new Map([['pages/board::boardSocket', def]]);

    const { resolveConnection } = await import('../socket-resolution.js');
    const honoApp = new Hono();
    let capturedParams: Record<string, string> | undefined;
    let capturedDenied: boolean | undefined;
    honoApp.get('/probe', async (ctx) => {
      const resolved = await resolveConnection(ctx, {
        registry,
        resolvePageUse: () => [],
        resolveRoutePath: () => undefined,
      });
      if (resolved.kind === 'socket') {
        capturedParams = resolved.params;
        capturedDenied = resolved.denied;
      }
      return ctx.text('ok');
    });
    // No r= param, so the required :id slot is missing -> denied 4403.
    await honoApp.request(
      `http://localhost/probe?${SOCKET_MODULE_PARAM}=${encodeURIComponent('pages/board')}&${SOCKET_NAME_PARAM}=boardSocket`
    );

    expect(capturedDenied).toBe(true);
    expect(capturedParams).toBeDefined();
    expect(Object.getPrototypeOf(capturedParams)).toBeNull();
  });

  it('a colocated socket data factory can mutate its (empty) params argument without throwing', async () => {
    // Regression for the frozen-EMPTY_PARAMS bug: the empty params object
    // handed to every colocated socket's data factory used to be ONE
    // Object.freeze'd singleton shared across every connection. A factory
    // doing `params.derived = computeFrom(c)` threw
    // `TypeError: Cannot add property derived, object is not extensible`.
    // The fix (emptyParams()) hands each call a FRESH, extensible,
    // null-proto object, so the mutation must succeed silently.
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    let mutationThrew = false;
    let readBack: unknown;
    let missingProtoKey: unknown;
    const def = defineSocket<never, never, { derived: string }>({
      data: (_c, rawParams) => {
        const params = rawParams as Record<string, unknown>;
        try {
          // params is empty (colocated, no __routeId) but must still be
          // extensible: a real-world factory commonly derives socket.data
          // from request-scoped state, not from the (empty) params object
          // itself, but the object identity is the same one this mutation
          // targets.
          params.derived = 'computed';
        } catch {
          mutationThrew = true;
        }
        readBack = params.derived;
        // A missing Object.prototype-named key must still read undefined:
        // mutability must not have reopened the prototype-chain hole.
        missingProtoKey = params.constructor;
        return { derived: 'computed' };
      },
    }) as unknown as SocketDef<never, never, { derived: string }>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(mutationThrew).toBe(false);
    expect(readBack).toBe('computed');
    expect(missingProtoKey).toBeUndefined();
  });

  it('two connections to a colocated socket get DIFFERENT (non-aliased) empty params objects', async () => {
    // A shared frozen singleton meant every connection's data factory saw
    // the SAME object; a mutation by one connection would have been visible
    // to every other connection that hit the same empty-params call site.
    // emptyParams() returns a fresh object per call, so no two connections
    // should ever observe each other's mutation.
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const seenParamsObjects: Record<string, unknown>[] = [];
    const def = defineSocket<never, never, undefined>({
      data: (_c, rawParams) => {
        const p = rawParams as Record<string, unknown>;
        // If this connection ever saw a PRIOR connection's mutation, the key
        // would already be present here.
        expect(Object.hasOwn(p, 'taggedBy')).toBe(false);
        p.taggedBy = `conn-${seenParamsObjects.length}`;
        seenParamsObjects.push(p);
        return undefined;
      },
    }) as unknown as SocketDef<never, never, undefined>;

    const registry = new Map([['pages/chat::chatSocket', def]]);
    app = makeApp(registry);

    await getRequest('pages/chat', 'chatSocket');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);

    await getRequest('pages/chat', 'chatSocket');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);

    expect(seenParamsObjects).toHaveLength(2);
    expect(seenParamsObjects[0]).not.toBe(seenParamsObjects[1]);
    expect(seenParamsObjects[0]!.taggedBy).toBe('conn-0');
    expect(seenParamsObjects[1]!.taggedBy).toBe('conn-1');
  });
});
