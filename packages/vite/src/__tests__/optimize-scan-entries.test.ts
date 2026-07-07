import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Cold-start regression guard for the SSR prerender __H crash.
//
// A honoPreact Cloudflare app's only route lazily imports a view that itself
// lazily imports a CJS dep (`zod`) the SSR entry scan never sees (it is
// reachable only through the routes-manifest, not a static import from the
// generated server entry). Without Task 1's configEnvironment hook, the
// optimizer discovers `zod` mid-prerender (workerd/ssr needs it pre-bundled
// since it's CJS), triggers a dep-optimizer reload, and the in-flight request
// crashes with a `__H` 500 instead of completing. `optimizeDeps: { force: true }`
// guarantees a cold cache so the first request is the one that would race.
const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, 'fixtures/optimize-scan');

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

describe('SSR optimizer scan entries: cold first-request', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    // honoPreact() writes its generated server-entry relative to
    // process.cwd(), and wrangler.jsonc's `main` points at that path relative
    // to the wrangler dir (= the vite root = the fixture dir). They only line
    // up when cwd is the fixture dir (mirrors websocket-dev.test.ts / cf-room.test.ts).
    originalCwd = process.cwd();
    process.chdir(fixtureRoot);
    server = await createServer({
      root: fixtureRoot,
      server: { port: 0 },
      optimizeDeps: { force: true },
    });
    await server.listen();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('serves the first request to a lazy route with a late dep as 200, not a __H 500', async () => {
    const res = await fetch(`http://localhost:${serverPort(server)}/`);
    const body = await res.text();
    expect(body).not.toContain('__H');
    expect(res.status).toBe(200);
  }, 30_000);
});
