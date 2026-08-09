import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Does a page actually RENDER?
 *
 * Every other suite in this repo asserts on units. None of them ever issues an
 * HTTP request for a page and looks at the status, and that gap let three
 * independent SSR-500s ship at once in v0.13.0:
 *
 *  1. Prod worker, `/demo/login` only: `preact-render-to-string`'s `prerender`
 *     snapshots `options.__r` at entry, and `@preact/signals` (reachable from
 *     the built entry only through lazy route chunks) installed its adapter
 *     hook mid-render, after the snapshot. `currentComponent` stayed undefined
 *     and the first signals hook threw `__$f` of undefined.
 *  2. Dev, Cloudflare env, EVERY route: `preact/devtools` is injected by
 *     `@preact/preset-vite` in a transform, so the dep scan cannot see it; it
 *     was discovered mid-startup, re-optimized, and left two `?v=` instances of
 *     `@preact/signals` live, each chaining an `options.__r` hook -> the second
 *     called `.S()` on an already-RUNNING effect -> `Cycle detected`.
 *  3. Dev, Node adapter, EVERY page: `Cycle detected` again, single signals
 *     instance this time.
 *
 * All three are module-graph / bundling-order faults. They cannot reproduce
 * under Vitest's own module resolution, so no unit test can ever catch them --
 * only booting the real thing and asking for a page can. #3 in particular hid
 * behind integration tests that DO boot this exact dev server but only ever
 * open WebSockets against it.
 *
 * This suite is deliberately shallow and broad: status codes only, no DOM
 * assertions. Its whole job is "the server can render its pages at all".
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

type SmokeTarget = {
  /** Display name; also the describe block title. */
  name: string;
  /** App root passed to Vite (and chdir'd into; see the note in `boot`). */
  root: string;
  /** Paths that must render. Keep these to real pages, not API routes. */
  routes: string[];
};

const TARGETS: SmokeTarget[] = [
  {
    name: 'Node adapter (apps/example-node)',
    root: resolve(repoRoot, 'apps/example-node'),
    routes: ['/', '/about'],
  },
  {
    name: 'Cloudflare adapter (apps/site)',
    root: resolve(repoRoot, 'apps/site'),
    // `/demo/login` is load-bearing: it is the only route in the repo with no
    // loader whose component calls signals hooks directly, which is exactly the
    // shape that produced bug 1. Do not drop it for being "just another page".
    routes: ['/', '/demo', '/demo/login', '/demo/cursors', '/docs'],
  },
];

describe.each(TARGETS)('page render smoke: $name', ({ root, routes }) => {
  let server: ViteDevServer;
  let originalCwd: string;
  let port: number;

  beforeAll(async () => {
    // `honoPreact()` writes its generated server-entry files relative to
    // process.cwd(), and the entry wrapper's bare imports resolve through the
    // app's own node_modules. Apps are normally run from their own directory,
    // so mirror that or the generated files land in the repo root and the
    // bare imports fail to resolve.
    originalCwd = process.cwd();
    process.chdir(root);
    server = await createServer({
      root,
      server: { port: 0 },
      logLevel: 'warn',
      // Force a COLD dep-optimizer run, matching `pnpm dev` (which is
      // `vite --force`). This is not incidental: bug 2 above only reproduces on
      // a cold cache, because it is a late dep discovery forcing a re-optimize
      // mid-startup. Against a warm `node_modules/.vite` the re-optimize never
      // happens and the suite goes green on genuinely broken code.
      optimizeDeps: { force: true },
    });
    await server.listen();
    const addr = server.httpServer!.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    if (originalCwd) process.chdir(originalCwd);
  });

  it.each(routes)('renders %s', async (path) => {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = await res.text();

    // Redirects are legitimate for guarded routes; anything at or above 400 is
    // not. The body slice goes into the message because an SSR 500 here prints
    // the framework's error page, which names the actual throw.
    expect(
      res.status,
      `${path} -> ${res.status}\n${body.slice(0, 800)}`
    ).toBeLessThan(400);
  });
});
