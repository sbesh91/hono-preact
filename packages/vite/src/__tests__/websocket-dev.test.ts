import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { WebSocket } from 'ws';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exampleNodeRoot = resolve(here, '../../../../apps/example-node');
const cfWsRoot = resolve(here, 'fixtures/cf-ws');

// Generous timeouts: starting a real Vite dev server (and, for the Cloudflare
// case, workerd) takes noticeably longer than an in-memory unit test.

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function echoOverWs(port: number, message: string): Promise<string> {
  return new Promise<string>((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const timer = setTimeout(() => {
      ws.close();
      rej(new Error('ws timeout'));
    }, 15_000);
    ws.on('open', () => ws.send(message));
    ws.on('message', (data) => {
      clearTimeout(timer);
      ws.close();
      res(data.toString());
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

describe('Node adapter: WebSocket in dev', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    // honoPreact() writes its generated server-entry files relative to
    // process.cwd(), and the entry wrapper's bare imports (@hono/node-server)
    // resolve through the app's own node_modules. The app is normally run
    // from its own directory (pnpm --filter example-node dev); mirror that so
    // the generated files land under apps/example-node, not the repo root.
    originalCwd = process.cwd();
    process.chdir(exampleNodeRoot);
    server = await createServer({ root: exampleNodeRoot, server: { port: 0 } });
    await server.listen();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('echoes a message over /ws', async () => {
    const reply = await echoOverWs(serverPort(server), 'hello');
    expect(reply).toBe('echo: hello');
  }, 20_000);
});

describe('Cloudflare adapter: WebSocket in dev', () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await createServer({ root: cfWsRoot, server: { port: 0 } });
    await server.listen();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('echoes a message over /ws', async () => {
    const reply = await echoOverWs(serverPort(server), 'hello');
    expect(reply).toBe('echo: hello');
  }, 20_000);
});
