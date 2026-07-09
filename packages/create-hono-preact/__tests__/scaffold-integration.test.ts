import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

let workDir: string;
let tarballPath: string;
let uiTarballPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-integration-'));

  // Build the three internal packages plus the umbrella. The umbrella's
  // consolidate.mjs copies the three dists into its own and rewrites imports,
  // so the packed tarball is self-contained.
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@hono-preact/iso',
      '--filter',
      '@hono-preact/server',
      '--filter',
      '@hono-preact/vite',
      '--filter',
      'hono-preact',
      '--filter',
      'hono-preact-ui',
      'build',
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );

  const packDir = join(workDir, 'tarballs');
  execFileSync(
    'pnpm',
    ['pack', '--filter', 'hono-preact', '--pack-destination', packDir],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    }
  );

  const entries = readdirSync(packDir);
  const tgz = entries.find(
    (f) => f.startsWith('hono-preact-') && f.endsWith('.tgz')
  );
  if (!tgz) throw new Error('failed to locate packed hono-preact tarball');
  tarballPath = join(packDir, tgz);

  execFileSync(
    'pnpm',
    ['pack', '--filter', 'hono-preact-ui', '--pack-destination', packDir],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  const uiTgz = readdirSync(packDir).find(
    (f) => f.startsWith('hono-preact-ui-') && f.endsWith('.tgz')
  );
  if (!uiTgz) throw new Error('failed to locate packed hono-preact-ui tarball');
  uiTarballPath = join(packDir, uiTgz);
}, 180_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function scaffold(
  name: string,
  adapter: 'cloudflare' | 'node',
  ui = false
): Promise<string> {
  const argv = [name, `--adapter=${adapter}`, '--no-install', '--no-git'];
  if (ui) argv.push('--ui');
  const code = await run({ argv, cwd: workDir, env: {} });
  if (code !== 0) throw new Error(`scaffold failed with code ${code}`);

  const target = join(workDir, name);
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies['hono-preact'] = `file:${tarballPath}`;
  if (ui) pkg.dependencies['hono-preact-ui'] = `file:${uiTarballPath}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  return target;
}

describe('scaffold + install + build — node adapter', () => {
  it('produces a buildable Node app', async () => {
    const target = await scaffold('integration-node', 'node');

    execFileSync(
      'pnpm',
      ['install', '--prefer-offline', '--no-frozen-lockfile'],
      {
        cwd: target,
        stdio: 'inherit',
      }
    );

    // The template ships a typecheck script (the agent recipes verify with
    // it); it must pass in a fresh scaffold.
    execFileSync('pnpm', ['typecheck'], { cwd: target, stdio: 'inherit' });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'server', 'server-entry.js'))).toBe(
      true
    );

    // The route table has no explicit server: field; the colocated
    // home.server.ts must still be auto-discovered into the server build.
    // The loader lands in a split chunk rather than the entry file, so scan
    // every server output file rather than just server-entry.js.
    const serverDir = join(target, 'dist', 'server');
    const serverFiles = readdirSync(serverDir, { recursive: true }).filter(
      (f): f is string => typeof f === 'string' && f.endsWith('.js')
    );
    const foundLoaderString = serverFiles.some((f) =>
      readFileSync(join(serverDir, f), 'utf8').includes(
        'Hello from your hono-preact app!'
      )
    );
    expect(foundLoaderString).toBe(true);
  }, 180_000);
});

describe('scaffold + install + build — cloudflare adapter', () => {
  it('produces a buildable Cloudflare app', async () => {
    const target = await scaffold('integration-cf', 'cloudflare', true);

    execFileSync(
      'pnpm',
      ['install', '--prefer-offline', '--no-frozen-lockfile'],
      {
        cwd: target,
        stdio: 'inherit',
      }
    );

    // This variant scaffolds with --ui, so it also typechecks the ui
    // overlay page.
    execFileSync('pnpm', ['typecheck'], { cwd: target, stdio: 'inherit' });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    // Worker output dir: name with hyphens -> underscores ("integration-cf" -> "integration_cf").
    expect(existsSync(join(target, 'dist', 'integration_cf'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'integration_cf', 'index.js'))).toBe(
      true
    );

    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).toContain('hono-preact-ui');
  }, 180_000);
});
