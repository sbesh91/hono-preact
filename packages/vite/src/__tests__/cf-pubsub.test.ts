import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO pub/sub integration test (PR 5b). A fixture app using
// cloudflareAdapter() is served through the @cloudflare/vite-plugin workerd dev
// server (same mechanism as cf-room.test.ts). Two SSE `live`-loader
// subscriptions (POST /__loaders) each open a worker->DO topic socket; a single
// publish (GET /__test_publish, which calls the framework publish()) must WAKE
// BOTH subscriptions through the DO, each delivering a fresh chunk. The proof is
// the fan-out (each subscriber's chunk ARRIVES), not a shared value: PR 5b syncs
// the wake event cross-isolate, not state (so the fixture carries no shared
// counter, which would be per-isolate on workerd anyway).

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/cf-pubsub');

// The loader wire identity (see loaders-handler + loader-fetch): module key
// 'src/data' (deriveModuleKey of src/data.server.ts at the fixture root), loader
// name 'pings' (the serverLoaders property), location for the '/' route.
const MODULE_KEY = 'src/data';
const LOADER_NAME = 'pings';
const LOADERS_RPC_PATH = '/__loaders';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

/**
 * Open an SSE `live`-loader subscription and COUNT the `message` chunks that
 * arrive (the initial load plus one per publish that wakes it). Returns a reader
 * with `arrivals`, `waitForArrivals(n)`, and `close()`.
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
  let arrivals = 0;
  let waiters: Array<{
    target: number;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const settle = () => {
    waiters = waiters.filter((w) => {
      if (arrivals >= w.target) {
        clearTimeout(w.timer);
        w.resolve();
        return false;
      }
      return true;
    });
  };

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
            // A live-loader chunk is a JSON object; keepalives are not.
            if (parsed && typeof parsed === 'object') {
              arrivals += 1;
              settle();
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
    get arrivals() {
      return arrivals;
    },
    waitForArrivals(target: number, timeoutMs = 8_000): Promise<void> {
      if (arrivals >= target) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`only ${arrivals}/${target} chunks arrived`)),
          timeoutMs
        );
        waiters.push({ target, resolve, timer });
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

  it('a publish() wakes BOTH live-loader subscriptions through the DO', async () => {
    const port = serverPort(server);

    const a = await openLiveLoader(port);
    const b = await openLiveLoader(port);

    // Each subscription delivers its initial chunk first (the load() one-shot).
    await a.waitForArrivals(1);
    await b.waitForArrivals(1);

    // Let both worker->DO topic subscriptions register before publishing.
    await new Promise<void>((res) => setTimeout(res, 500));

    // One publish() in the api isolate must wake BOTH subscriptions through the
    // DO (cross-isolate fan-out), each delivering a second chunk. Remove the DO
    // publish branch or the topic accept and these waits time out.
    const pub = await fetch(`http://localhost:${port}/__test_publish`);
    expect(pub.status).toBe(200);

    await a.waitForArrivals(2);
    await b.waitForArrivals(2);
    expect(a.arrivals).toBe(2);
    expect(b.arrivals).toBe(2);

    await a.close();
    await b.close();
  }, 60_000);
});
