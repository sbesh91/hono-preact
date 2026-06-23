/**
 * Node integration test for the duplex socket path.
 *
 * Boots a real @hono/node-server with @hono/node-ws, registers the chat
 * socket definition via a synthetic serverImports registry, then opens a
 * real `ws` client to /__sockets and verifies:
 *   - an echo reply comes back for a { kind: 'say', text } message
 *   - the per-connection tick interval starts after open
 *   - the teardown returned by open clears the interval on close
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { defineSocket } from '@hono-preact/iso';
import type { SocketDef } from '@hono-preact/iso/internal';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
} from '@hono-preact/iso/internal/runtime';
import { socketsHandler } from '../sockets-handler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wsUrl(port: number, moduleKey: string, socketName: string): string {
  return (
    `ws://localhost:${port}${SOCKETS_RPC_PATH}` +
    `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey)}` +
    `&${SOCKET_NAME_PARAM}=${encodeURIComponent(socketName)}`
  );
}

function connectWs(url: string): {
  ws: WebSocket;
  messages: string[];
  waitForMessage: (timeout?: number) => Promise<string>;
  waitForClose: (timeout?: number) => Promise<{ code: number; reason: string }>;
} {
  const ws = new WebSocket(url);
  const messages: string[] = [];
  const messageWaiters: Array<(msg: string) => void> = [];
  const closeWaiters: Array<(info: { code: number; reason: string }) => void> =
    [];

  ws.on('message', (data) => {
    const str = data.toString();
    messages.push(str);
    messageWaiters.shift()?.(str);
  });
  ws.on('close', (code, reason) => {
    closeWaiters.shift()?.({ code, reason: reason.toString() });
  });

  return {
    ws,
    messages,
    waitForMessage(timeout = 5_000) {
      return new Promise<string>((res, rej) => {
        const t = setTimeout(
          () => rej(new Error('ws message timeout')),
          timeout
        );
        messageWaiters.push((msg) => {
          clearTimeout(t);
          res(msg);
        });
      });
    },
    waitForClose(timeout = 5_000) {
      return new Promise<{ code: number; reason: string }>((res, rej) => {
        const t = setTimeout(() => rej(new Error('ws close timeout')), timeout);
        closeWaiters.push((info) => {
          clearTimeout(t);
          res(info);
        });
      });
    },
  };
}

function waitForOpen(ws: WebSocket, timeout = 5_000): Promise<void> {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) {
      res();
      return;
    }
    const t = setTimeout(() => rej(new Error('ws open timeout')), timeout);
    ws.once('open', () => {
      clearTimeout(t);
      res();
    });
    ws.once('error', (err) => {
      clearTimeout(t);
      rej(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Test setup: spin up a real HTTP server + node-ws
// ---------------------------------------------------------------------------

// Lazy dynamic imports so the test file loads without touching @hono/node-server
// at import time (keeping the module graph clean).
type NodeServer = import('@hono/node-server').ServerType;

const MODULE_KEY = 'test/chat';
const SOCKET_NAME = 'chat';

let server: NodeServer;
let port: number;

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string } | { kind: 'tick'; n: number };

// Track teardown calls so the test can assert the interval was cleared.
let teardownCalled = false;
// Track active timer ids so we can assert clearInterval ran.
const activeTimers = new Set<ReturnType<typeof setInterval>>();

// data factory provides the initial { n } bag; open mutates it across the
// per-connection interval. With fix B the factory must be present for data to
// be defined (no factory means socket.data is undefined, not {}).
const chatDef = defineSocket<Incoming, Outgoing, { n: number }>({
  data: () => ({ n: 0 }),
  open(socket) {
    const id = setInterval(() => {
      socket.data.n += 1;
      socket.send({ kind: 'tick', n: socket.data.n });
    }, 100);
    activeTimers.add(id);
    return () => {
      teardownCalled = true;
      clearInterval(id);
      activeTimers.delete(id);
    };
  },
  message(socket, msg) {
    if (msg.kind === 'say') socket.send({ kind: 'echo', text: msg.text });
  },
}) as unknown as SocketDef<Incoming, Outgoing, { n: number }>;

beforeAll(async () => {
  // Dynamic imports keep @hono/node-server and @hono/node-ws out of the static
  // import graph; this mirrors websocket-dev.test.ts's approach.
  const { serve } = await import('@hono/node-server');
  const { createNodeWebSocket } = await import('@hono/node-ws');

  const registry = new Map<string, SocketDef<unknown, unknown, unknown>>([
    [
      `${MODULE_KEY}::${SOCKET_NAME}`,
      chatDef as SocketDef<unknown, unknown, unknown>,
    ],
  ]);

  const app = new Hono();
  app.get(SOCKETS_RPC_PATH, socketsHandler({ registry }));

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  installWebSocketUpgrader(upgradeWebSocket);

  // port: 0 lets the OS assign a free port.
  server = serve({ fetch: app.fetch, port: 0 });
  injectWebSocket(server);

  port = (server.address() as AddressInfo).port;
}, 30_000);

afterAll(async () => {
  __resetWebSocketUpgraderForTesting();
  await new Promise<void>((res) => server.close(() => res()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sockets-integration: real Node WS round-trip', () => {
  it('echoes a { kind: "say" } message back as { kind: "echo" }', async () => {
    const url = wsUrl(port, MODULE_KEY, SOCKET_NAME);
    const { ws, waitForMessage } = connectWs(url);

    await waitForOpen(ws);
    ws.send(JSON.stringify({ kind: 'say', text: 'hello world' }));

    // Drain messages until we get an echo (ticks may arrive first).
    let echo: { kind: string; text?: string } | undefined;
    for (let i = 0; i < 10 && !echo; i++) {
      const raw = await waitForMessage(3_000);
      const parsed = JSON.parse(raw) as { kind: string; text?: string };
      if (parsed.kind === 'echo') echo = parsed;
    }

    expect(echo).toEqual({ kind: 'echo', text: 'hello world' });
    ws.close(1000);
  }, 10_000);

  it('sends tick messages from the per-connection interval', async () => {
    const url = wsUrl(port, MODULE_KEY, SOCKET_NAME);
    const { ws, waitForMessage } = connectWs(url);

    await waitForOpen(ws);

    // Wait for at least one tick.
    let tick: { kind: string; n?: number } | undefined;
    for (let i = 0; i < 10 && !tick; i++) {
      const raw = await waitForMessage(3_000);
      const parsed = JSON.parse(raw) as { kind: string; n?: number };
      if (parsed.kind === 'tick') tick = parsed;
    }

    expect(tick?.kind).toBe('tick');
    expect(typeof tick?.n).toBe('number');
    ws.close(1000);
  }, 10_000);

  it('teardown clears the interval when the connection closes', async () => {
    teardownCalled = false;

    const url = wsUrl(port, MODULE_KEY, SOCKET_NAME);
    const { ws, waitForClose } = connectWs(url);

    await waitForOpen(ws);
    const closeP = waitForClose(5_000);
    ws.close(1000);
    await closeP;

    // Give the server's onClose handler a tick to run.
    await new Promise<void>((res) => setTimeout(res, 50));

    expect(teardownCalled).toBe(true);
    expect(activeTimers.size).toBe(0);
  }, 10_000);

  it('closes 4403 for an unknown socket name', async () => {
    const url = wsUrl(port, MODULE_KEY, 'nonexistent');
    const { ws, waitForClose } = connectWs(url);

    await waitForOpen(ws).catch(() => {
      /* connection may close before open event */
    });
    const info = await waitForClose(5_000);

    expect(info.code).toBe(4403);
  }, 10_000);
});
