import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO pub/sub integration test (PR 5b). A fixture app using
// cloudflareAdapter() is served through the @cloudflare/vite-plugin workerd dev
// server (same mechanism as cf-room.test.ts). Two SSE `live`-loader
// subscriptions (POST /__loaders) each open a worker->DO topic socket; a publish
// (GET /__test_publish, which calls the framework publish()) must fan out to
// BOTH subscriptions through the DO, proving cross-isolate fan-out.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/cf-pubsub');

// The loader wire identity (see loaders-handler + loader-fetch): module key
// 'src/data' (deriveModuleKey of src/data.server.ts at the fixture root), loader
// name 'count' (the serverLoaders property), location for the '/' route.
const MODULE_KEY = 'src/data';
const LOADER_NAME = 'count';
const LOADERS_RPC_PATH = '/__loaders';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

/**
 * Open an SSE `live`-loader subscription and yield each parsed `message` event's
 * data object ({ count }). Returns a reader with nextChunk() and close().
 */
async function openLiveLoader(port: number) {
  const res = await fetch(`http://localhost:${port}${LOADERS_RPC_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: MODULE_KEY,
      loader: LOADER_NAME,
      location: { path: '/', pathParams: {}, searchParams: {} },
    }),
  });
  if (!res.body) throw new Error('no SSE body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Array<{ count: number }> = [];
  let waiters: Array<(v: { count: number }) => void> = [];

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // SSE frames are separated by a blank line; a `message` event is the
        // default (a bare `data:` line, no explicit `event:`).
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const isMessage = !frame
            .split('\n')
            .some((l) => l.startsWith('event:') && !l.includes('message'));
          if (!isMessage) continue;
          try {
            const parsed = JSON.parse(dataLine.slice('data:'.length).trim());
            if (parsed && typeof parsed.count === 'number') {
              if (waiters.length) waiters.shift()!(parsed);
              else queue.push(parsed);
            }
          } catch {
            /* ignore non-JSON keepalive frames */
          }
        }
      }
    } catch {
      /* stream aborted on close */
    }
  })();

  return {
    nextChunk(timeoutMs = 8_000): Promise<{ count: number }> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      return new Promise((res2, rej) => {
        const t = setTimeout(() => rej(new Error('chunk timeout')), timeoutMs);
        waiters.push((v) => {
          clearTimeout(t);
          res2(v);
        });
      });
    },
    async close() {
      waiters = [];
      await reader.cancel().catch(() => {});
    },
  };
}

describe('Cloudflare adapter: DO pub/sub (two live-loader subscribers, cross-isolate publish)', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(fixtureRoot);
    server = await createServer({ root: fixtureRoot, server: { port: 0 } });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('a publish() fans out to BOTH live-loader subscriptions through the DO', async () => {
    const port = serverPort(server);

    const a = await openLiveLoader(port);
    const b = await openLiveLoader(port);

    // Each subscription pushes its initial value first (the load() one-shot).
    expect((await a.nextChunk()).count).toBe(0);
    expect((await b.nextChunk()).count).toBe(0);

    // Let both worker->DO topic subscriptions register before publishing.
    await new Promise<void>((res) => setTimeout(res, 500));

    // Trigger publish() in the api isolate; it must reach BOTH subscriptions
    // through the DO (cross-isolate fan-out), re-running their load() -> count 1.
    const pub = await fetch(`http://localhost:${port}/__test_publish`);
    expect(pub.status).toBe(200);

    expect((await a.nextChunk()).count).toBe(1);
    expect((await b.nextChunk()).count).toBe(1);

    await a.close();
    await b.close();
  }, 60_000);
});
