import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as scaffoldCli } from '../packages/create-hono-preact/lib/cli.mjs';
import { walkBootGraph, formatGraphFailures } from './module-graph.js';
import { freePort, waitForServer } from './net.js';

/**
 * Does a page render in an app built from the PUBLISHED package?
 *
 * The other two smoke files serve the in-repo apps, which alias `hono-preact`
 * to `packages/*\/src`, so Vite transforms the framework as app source. A user's
 * app gets the packed `dist` from node_modules instead, and under the Node
 * adapter Vite's SSR loads it externalized: plain Node, no
 * `import.meta.env`, and a separate client dep-optimizer pass. Every scaffolded
 * Node app 500'd on every page, in dev and in the built server, for that reason
 * alone, while every in-repo suite stayed green. The only faithful repro is the
 * one a user runs: pack, scaffold, install the tarball, boot.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const ROUTES = ['/', '/about'];

/**
 * Without NODE_ENV, as a user's shell has it. Vitest sets `test`, which would
 * leak into Vite's mode resolution in the spawned dev server.
 */
function userEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const { NODE_ENV: _drop, ...rest } = process.env;
  return { ...rest, CI: 'true', ...extra };
}

function startServer(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): { child: ChildProcess; output: () => string } {
  let out = '';
  const child = spawn(cmd, args, { cwd, env, stdio: 'pipe', shell: false });
  child.stdout?.on('data', (d) => (out += d.toString()));
  child.stderr?.on('data', (d) => (out += d.toString()));
  return { child, output: () => out };
}

async function expectRoutesRender(port: number): Promise<void> {
  for (const path of ROUTES) {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = await res.text();
    expect(res.status, `${path} -> ${res.status}\n${body.slice(0, 800)}`).toBe(
      200
    );
  }
}

async function expectBootGraphLoads(port: number, floor: number) {
  const url = `http://localhost:${port}/`;
  const html = await (await fetch(url)).text();
  const result = await walkBootGraph(url, html);
  expect(
    result.checked.length,
    `too few module scripts in the rendered document: ${JSON.stringify(result.checked)}`
  ).toBeGreaterThanOrEqual(floor);
  expect(
    result.failures,
    `modules not served as JavaScript:\n\n${formatGraphFailures(result)}`
  ).toEqual([]);
}

describe('packed-package smoke: scaffolded Node app', () => {
  let workDir: string;
  let app: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'hp-packed-smoke-'));

    // The framework dist must already be built (the smoke workflow builds it).
    execFileSync(
      'pnpm',
      ['pack', '--filter', 'hono-preact', '--pack-destination', workDir],
      { cwd: repoRoot, stdio: 'pipe' }
    );
    const tgz = readdirSync(workDir).find(
      (f) => f.startsWith('hono-preact-') && f.endsWith('.tgz')
    );
    if (!tgz)
      throw new Error('failed to locate the packed hono-preact tarball');

    const code = await scaffoldCli({
      argv: ['app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      nodeVersion: process.version,
    });
    if (code !== 0) throw new Error(`scaffold exited ${code}`);
    app = join(workDir, 'app');

    const pkgPath = join(app, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.dependencies['hono-preact'] = `file:${join(workDir, tgz)}`;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: app,
      stdio: 'pipe',
      env: userEnv({}),
    });
  }, 600_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  describe('dev server', () => {
    let port: number;
    let server: ReturnType<typeof startServer>;

    beforeAll(async () => {
      port = await freePort();
      // `--force`: the client re-optimize this guards against only happens on
      // a cold dep cache, and `pnpm dev` is what a user runs first.
      server = startServer(
        'pnpm',
        ['exec', 'vite', '--port', String(port), '--strictPort', '--force'],
        app,
        userEnv({})
      );
      await waitForServer(port, 120_000);
    }, 180_000);

    afterAll(() => {
      server?.child.kill('SIGTERM');
    });

    it('renders every page', async () => {
      await expectRoutesRender(port);
    });

    it('boots a client module graph that loads', async () => {
      await expectBootGraphLoads(port, 2);
    });

    // A first-visit discovery re-optimize reloads a page that is already
    // running the previous bundle; the browser then holds two
    // `@preact/signals` copies and hydration throws `reading '__$f'`. The boot
    // graph walk above requested every module a first visit does, so any dep
    // the startup scan missed has been discovered by now.
    it('needs no dep re-optimize after the first visit', async () => {
      await new Promise((r) => setTimeout(r, 2_000));
      expect(server.output()).not.toContain('optimized dependencies changed');
    });
  });

  describe('built server', () => {
    let port: number;
    let server: ReturnType<typeof startServer>;

    beforeAll(async () => {
      // Pin production: Vitest's NODE_ENV=test would fold `import.meta.env.PROD`
      // to false and strip the Node adapter's serve() boot from the build.
      execFileSync('pnpm', ['run', 'build'], {
        cwd: app,
        stdio: 'pipe',
        env: userEnv({ NODE_ENV: 'production' }),
      });
      port = await freePort();
      server = startServer(
        'node',
        ['dist/server/server-entry.js'],
        app,
        userEnv({ NODE_ENV: 'production', PORT: String(port) })
      );
      await waitForServer(port, 60_000);
    }, 300_000);

    afterAll(() => {
      server?.child.kill('SIGTERM');
    });

    it('renders every page', async () => {
      await expectRoutesRender(port);
    });

    it('ships a client module graph that loads', async () => {
      await expectBootGraphLoads(port, 1);
    });
  });
});
