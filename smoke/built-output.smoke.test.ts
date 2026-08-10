import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
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
  /**
   * When set, the built server is also started a second time from the repo
   * root instead of the app directory, and a real client asset is fetched
   * from it. This is the only way to catch a cwd-relative path baked into the
   * emitted entry: it is a property of the built module's runtime cwd, so no
   * unit test can reproduce it.
   */
  foreignCwdServe?: (port: number) => { cmd: string; args: string[] };
};

const TARGETS: BuiltTarget[] = [
  {
    name: 'Node adapter (apps/example-node)',
    root: resolve(repoRoot, 'apps/example-node'),
    distProbe: 'dist/server/server-entry.js',
    serve: () => ({ cmd: 'node', args: ['dist/server/server-entry.js'] }),
    routes: ['/', '/about'],
    foreignCwdServe: () => ({
      cmd: 'node',
      args: [
        resolve(repoRoot, 'apps/example-node/dist/server/server-entry.js'),
      ],
    }),
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

/**
 * Ask the OS for a free port, then hand the number to the child.
 *
 * Both servers are spawned as child processes that bind their own listener, so
 * there is no socket handle to read an ephemeral port back off of; the port has
 * to be chosen up front. Hard-coding one risks a collision with whatever else
 * is listening on a developer's machine or a CI runner, which would surface as
 * the deeply confusing "server never became reachable" (we would be polling
 * someone else's server, or losing the bind race). Binding to :0 and releasing
 * immediately is the standard way to get a number the OS just confirmed is
 * free. The tiny race between release and re-bind is acceptable here: this
 * suite runs with `fileParallelism: false` and one target at a time.
 */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.once('error', rej);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

describe.each(TARGETS)(
  'built output smoke: $name',
  ({ root, distProbe, serve, routes, foreignCwdServe }) => {
    let port: number;
    let child: ChildProcess;

    beforeAll(async () => {
      port = await freePort();
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

    it.skipIf(!foreignCwdServe)(
      'serves client assets when started from a foreign cwd',
      async () => {
        // Discover a real asset URL from the rendered page rather than
        // hard-coding a hashed filename.
        const html = await (await fetch(`http://localhost:${port}/`)).text();
        const asset = /\/static\/[A-Za-z0-9._-]+\.js/.exec(html)?.[0];
        expect(asset, `no /static/*.js URL in the rendered page`).toBeTruthy();

        const foreignPort = await freePort();
        const { cmd, args } = foreignCwdServe!(foreignPort);
        const foreign = spawn(cmd, args, {
          cwd: repoRoot,
          stdio: 'pipe',
          shell: false,
          env: { ...PROD_ENV, PORT: String(foreignPort), CI: 'true' },
        });
        try {
          await waitForServer(foreignPort, 60_000);
          const res = await fetch(`http://localhost:${foreignPort}${asset}`);
          const body = await res.text();

          // A bare status check is not enough: when serveStatic misses on the
          // foreign cwd, the request falls through to the SSR catch-all,
          // which answers 200 with the HTML page shell instead of the asset.
          // Prove this is the real JS asset, not the shell, by checking the
          // content-type and comparing bytes against the known-good server
          // already running from the project root on `port`.
          expect(
            res.status,
            `${asset} from a foreign cwd -> ${res.status}\n${body.slice(0, 200)}`
          ).toBe(200);
          expect(
            res.headers.get('content-type'),
            `${asset} from a foreign cwd had content-type ${res.headers.get('content-type')}, body started with:\n${body.slice(0, 200)}`
          ).toContain('javascript');

          const controlRes = await fetch(`http://localhost:${port}${asset}`);
          const controlBody = await controlRes.text();
          expect(
            body,
            `${asset} from a foreign cwd did not match the same asset served from the project-root cwd`
          ).toBe(controlBody);
        } finally {
          foreign.kill('SIGTERM');
        }
      },
      120_000
    );
  }
);
