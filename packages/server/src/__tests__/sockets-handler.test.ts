import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  defineServerMiddleware,
  defineSocket,
  type SocketDef,
} from '@hono-preact/iso';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  SOCKETS_RPC_PATH,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal/runtime';
import { buildSocketRegistry, socketsHandler } from '../sockets-handler.js';
import type { WebSocketUpgrader } from '@hono-preact/iso/internal/runtime';
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
