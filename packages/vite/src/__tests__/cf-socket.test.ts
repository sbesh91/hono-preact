import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { WebSocket } from 'ws';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO plain-socket integration test (issue #169). A fixture
// hono-preact app using cloudflareAdapter() is served through the
// @cloudflare/vite-plugin workerd dev server (same mechanism as cf-room.test.ts).
// A real `ws` client connects to /__sockets for a plain `defineSocket`; the
// worker guards at the edge then forwards the upgrade to a fresh per-connection
// Durable Object, where the socket handler runs. We assert the full duplex
// round-trip (client say -> server echo) carrying the edge-captured `who`, and
// that a guard-denied socket closes 4403. (The no-DO-contact property of the
// deny path is proven at the Node layer in sockets-handler.test.ts, which
// installs no upgrader so any forward would throw; this e2e only asserts the
// close code.)

const here = dirname(fileURLToPath(import.meta.url));
const cfSocketRoot = resolve(here, 'fixtures/cf-socket');

// deriveModuleKey(src/socket.server.ts, viteRoot=fixtureDir) = 'src/socket';
// the socket NAME is the serverSockets property name.
const MODULE_KEY = 'src/socket';
const SOCKET_NAME = 'echo';
const DENIED_NAME = 'deniedSocket';
const WS_DENY_CODE = 4403;
const SOCKETS_RPC_PATH = '/__sockets';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function socketUrl(port: number, name: string, user?: string): string {
  return (
    `ws://localhost:${port}${SOCKETS_RPC_PATH}` +
    `?m=${encodeURIComponent(MODULE_KEY)}` +
    `&s=${encodeURIComponent(name)}` +
    (user ? `&u=${encodeURIComponent(user)}` : '')
  );
}

function waitForOpen(ws: WebSocket, timeout = 10_000): Promise<void> {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res();
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

function waitForMessage(ws: WebSocket, timeout = 8_000): Promise<string> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws message timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(t);
      res(data.toString());
    });
  });
}

function waitForClose(ws: WebSocket, timeout = 10_000): Promise<number> {
  return new Promise((res, rej) => {
    let closed = false;
    const t = setTimeout(() => rej(new Error('ws close timeout')), timeout);
    ws.once('close', (code) => {
      closed = true;
      clearTimeout(t);
      res(code);
    });
    ws.once('error', (err) => {
      if (!closed) {
        clearTimeout(t);
        rej(err);
      }
    });
  });
}

describe('Cloudflare adapter: plain socket (per-connection DO, duplex round-trip)', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(cfSocketRoot);
    server = await createServer({ root: cfSocketRoot, server: { port: 0 } });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('client say -> server echo through the DO, carrying the edge data factory result', async () => {
    const port = serverPort(server);
    const ws = new WebSocket(socketUrl(port, SOCKET_NAME, 'alice'));
    await waitForOpen(ws);

    ws.send(JSON.stringify({ kind: 'say', text: 'hi there' }));
    const raw = await waitForMessage(ws);
    const env = JSON.parse(raw) as { kind: string; text: string; who: string };
    expect(env).toEqual({ kind: 'echo', text: 'hi there', who: 'alice' });

    ws.close(1000);
  }, 60_000);

  it('a socket without a data factory sees socket.data === undefined (Node parity)', async () => {
    const port = serverPort(server);
    // No `u` query and the `probe` socket has no data factory, so the connector
    // omits x-hp-data and the DO must resolve socket.data to undefined (not the
    // string-coerced null a `?? null` stamp would produce).
    const ws = new WebSocket(socketUrl(port, 'probe'));
    await waitForOpen(ws);

    ws.send(JSON.stringify({ kind: 'say', text: 'x' }));
    const raw = await waitForMessage(ws);
    const env = JSON.parse(raw) as { kind: string; dataIsUndefined: boolean };
    expect(env).toEqual({ kind: 'probe', dataIsUndefined: true });

    ws.close(1000);
  }, 60_000);

  it('a guard-denied socket closes WS_DENY_CODE (4403), not a worker 500', async () => {
    const port = serverPort(server);
    const denied = new WebSocket(socketUrl(port, DENIED_NAME));
    const code = await waitForClose(denied);
    expect(code).toBe(WS_DENY_CODE);
  }, 60_000);
});
