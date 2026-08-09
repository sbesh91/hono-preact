import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The same "does a page render?" question as page-render.smoke.test.ts, but
 * against BUILT output rather than the dev server.
 *
 * Both halves are required, because the two halves catch different faults. The
 * bug that actually 500'd production (`/demo/login` on framework.sbesh.com)
 * existed ONLY in the built bundle: `@preact/signals` was reachable from the
 * worker entry solely through lazily-imported route chunks, so it was first
 * evaluated mid-render -- after `preact-render-to-string`'s `prerender` had
 * already snapshotted `options.__r`. The dev server bundles its graph
 * differently and rendered that page fine. Conversely the dev-only
 * `Cycle detected` faults never appear in built output.
 *
 * So: a green dev smoke says nothing about the artifact you ship, and a green
 * built smoke says nothing about the server your developers run all day.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

type BuiltTarget = {
  name: string;
  /** App directory; its own `build` script is what we run. */
  root: string;
  /** Path that must exist post-build, proving the build actually emitted. */
  distProbe: string;
  /** How to serve the built artifact, given a port. */
  serve: (port: number) => { cmd: string; args: string[] };
  routes: string[];
};

const TARGETS: BuiltTarget[] = [
  {
    name: 'Node adapter (apps/example-node)',
    root: resolve(repoRoot, 'apps/example-node'),
    distProbe: 'dist/server/server-entry.js',
    serve: () => ({ cmd: 'node', args: ['dist/server/server-entry.js'] }),
    routes: ['/', '/about'],
  },
  {
    name: 'Cloudflare adapter (apps/site)',
    root: resolve(repoRoot, 'apps/site'),
    distProbe: 'dist/hono_preact/index.js',
    // The built worker, served by workerd exactly as it is in production.
    serve: (port) => ({
      cmd: 'pnpm',
      args: ['exec', 'wrangler', 'dev', '--port', String(port)],
    }),
    // `/demo/login` is the regression this file exists for. Keep it.
    routes: ['/', '/demo', '/demo/login', '/docs'],
  },
];

/**
 * Vitest sets `NODE_ENV=test`, and Vite derives `import.meta.env.PROD` from
 * NODE_ENV. Inheriting it would constant-fold `PROD` to FALSE in the build,
 * which dead-code-eliminates the Node adapter's `serve()` boot entirely: the
 * built entry then exits 0 without listening, and this suite would be smoke
 * testing an artifact that no one ever ships. Pin it for both the build and the
 * server we spawn from it.
 */
const PROD_ENV = { ...process.env, NODE_ENV: 'production' };

/** Run a command to completion in `cwd`, rejecting on a non-zero exit. */
function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'pipe',
      shell: false,
      env: PROD_ENV,
    });
    let err = '';
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('error', rej);
    child.on('exit', (code) =>
      code === 0
        ? res()
        : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${err}`))
    );
  });
}

/** Poll until the server answers anything at all, or time out. */
async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server on :${port} never became reachable`);
}

// Ports are fixed per target rather than OS-assigned: both servers are spawned
// as child processes that choose their own listener, so there is no handle to
// read an ephemeral port back off of.
let nextPort = 8971;

describe.each(TARGETS)(
  'built output smoke: $name',
  ({ root, distProbe, serve, routes }) => {
    const port = nextPort++;
    let child: ChildProcess;

    beforeAll(async () => {
      await run('pnpm', ['run', 'build'], root);
      expect(
        existsSync(resolve(root, distProbe)),
        `build produced no ${distProbe}`
      ).toBe(true);

      const { cmd, args } = serve(port);
      child = spawn(cmd, args, {
        cwd: root,
        stdio: 'pipe',
        shell: false,
        env: { ...PROD_ENV, PORT: String(port), CI: 'true' },
      });
      await waitForServer(port, 120_000);
    }, 600_000);

    afterAll(() => {
      child?.kill('SIGTERM');
    });

    it.each(routes)('renders %s', async (path) => {
      const res = await fetch(`http://localhost:${port}${path}`);
      const body = await res.text();
      expect(
        res.status,
        `${path} -> ${res.status}\n${body.slice(0, 800)}`
      ).toBeLessThan(400);
    });
  }
);
