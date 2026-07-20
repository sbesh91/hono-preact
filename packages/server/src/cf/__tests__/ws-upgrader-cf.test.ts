import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context, Next } from 'hono';
import type { WSEvents } from 'hono/ws';
import { makeCfWebSocketUpgrader } from '../ws-upgrader-cf.js';

// A fake workerd server socket recording the call order of accept / listener
// registration / send, so the test can assert onOpen fires AFTER accept().
function makeFakeSocket() {
  const calls: string[] = [];
  const listeners: Record<string, (evt: unknown) => void> = {};
  return {
    calls,
    listeners,
    accept: vi.fn(() => calls.push('accept')),
    addEventListener: vi.fn((type: string, cb: (evt: unknown) => void) => {
      calls.push(`listen:${type}`);
      listeners[type] = cb;
    }),
    send: vi.fn((data: unknown) => calls.push(`send:${String(data)}`)),
    close: vi.fn(),
    protocol: '',
    readyState: 1,
    url: 'https://example.com/ws',
  };
}

// Install fake workerd globals: the real Response rejects status 101, and
// WebSocketPair does not exist off-workerd.
function installGlobals() {
  const client = { __client: true };
  const server = makeFakeSocket();
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = client;
      1 = server;
    }
  );
  const responses: Array<{ status?: number; webSocket?: unknown }> = [];
  vi.stubGlobal(
    'Response',
    class {
      status?: number;
      webSocket?: unknown;
      constructor(
        _body: unknown,
        init?: { status?: number; webSocket?: unknown }
      ) {
        this.status = init?.status;
        this.webSocket = init?.webSocket;
        responses.push({ status: init?.status, webSocket: init?.webSocket });
      }
    }
  );
  return { client, server, responses };
}

function ctxWithUpgrade(
  hasUpgrade: boolean,
  upgradeValue = 'websocket'
): Context {
  return {
    req: {
      url: 'https://example.com/ws',
      header: (k: string) =>
        k === 'Upgrade' && hasUpgrade ? upgradeValue : undefined,
    },
  } as unknown as Context;
}

afterEach(() => vi.unstubAllGlobals());

describe('makeCfWebSocketUpgrader', () => {
  it('passes non-upgrade requests through to next() without creating a pair', async () => {
    vi.stubGlobal(
      'WebSocketPair',
      class {
        constructor() {
          throw new Error('should not construct');
        }
      }
    );
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({ onMessage() {} }));
    const next = vi.fn<Next>(async () => {});
    await handler(ctxWithUpgrade(false), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts, then fires onOpen for Node parity, and returns a 101 with the client socket', async () => {
    const { client, server } = installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    const openSpy = vi.fn();
    const handler = upgrader(() => ({
      onOpen: openSpy,
      onMessage() {},
    }));
    const res = (await handler(ctxWithUpgrade(true), vi.fn())) as unknown as {
      status: number;
      webSocket: unknown;
    };
    expect(server.accept).toHaveBeenCalledOnce();
    expect(openSpy).toHaveBeenCalledOnce();
    // onOpen must fire strictly AFTER accept() (the parity guarantee).
    expect(server.accept.mock.invocationCallOrder[0]).toBeLessThan(
      openSpy.mock.invocationCallOrder[0]
    );
    expect(res.status).toBe(101);
    expect(res.webSocket).toBe(client);
  });

  it('wires only the handlers that are present', async () => {
    const { server } = installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({ onMessage() {} }));
    await handler(ctxWithUpgrade(true), vi.fn());
    const listened = server.addEventListener.mock.calls.map((c) => c[0]);
    expect(listened).toEqual(['message']);
  });

  it('upgrades on a case-insensitive Upgrade header value (Node parity)', async () => {
    const { client } = installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({ onMessage() {} }));
    // `Upgrade: WebSocket` (mixed case) is a valid RFC 6455 token; Node upgrades
    // it, so Cloudflare must too.
    const res = (await handler(
      ctxWithUpgrade(true, 'WebSocket'),
      vi.fn()
    )) as unknown as { status: number; webSocket: unknown };
    expect(res.status).toBe(101);
    expect(res.webSocket).toBe(client);
  });

  it('exposes the request URL on ws.url (Node parity)', async () => {
    installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    let seenUrl: URL | null = null;
    // Annotate the factory return as WSEvents so onOpen's params are typed (a
    // union return type would not flow contextual types to the object literal).
    const handler = upgrader(
      (): WSEvents => ({
        onOpen(_e, ws) {
          seenUrl = ws.url;
        },
      })
    );
    await handler(ctxWithUpgrade(true), vi.fn());
    // Node's @hono/node-ws sets ws.url to the request URL; the workerd server
    // socket has none, so the upgrader must supply c.req.url for parity.
    expect(seenUrl).toBeInstanceOf(URL);
    // String(URL) is its href; avoids narrowing the closure-assigned local.
    expect(String(seenUrl)).toBe('https://example.com/ws');
  });

  it('keeps the handshake alive when onOpen throws (Node parity)', async () => {
    const { client, server } = installGlobals();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({
      onOpen() {
        throw new Error('boom');
      },
    }));
    const res = (await handler(ctxWithUpgrade(true), vi.fn())) as unknown as {
      status: number;
      webSocket: unknown;
    };
    // A thrown onOpen is logged, not propagated: the 101 still returns and the
    // client socket is handed back (on Node the connection stays open too).
    expect(res.status).toBe(101);
    expect(res.webSocket).toBe(client);
    expect(server.accept).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });

  it('swallows a throwing onMessage listener instead of propagating', async () => {
    const { server } = installGlobals();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({
      onMessage() {
        throw new Error('boom');
      },
    }));
    await handler(ctxWithUpgrade(true), vi.fn());
    const messageListener = server.listeners['message'];
    expect(messageListener).toBeTypeOf('function');
    // Invoking the registered listener must not throw out (Node wraps it too).
    expect(() =>
      messageListener(new MessageEvent('message', { data: 'x' }))
    ).not.toThrow();
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
