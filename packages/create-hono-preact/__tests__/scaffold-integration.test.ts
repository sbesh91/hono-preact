import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain JS module, no .d.ts
import { run } from '../lib/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

let workDir: string;
let tarballPath: string;

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
      'build',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  const packDir = join(workDir, 'tarballs');
  execFileSync('pnpm', ['pack', '--filter', 'hono-preact', '--pack-destination', packDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  const entries = readdirSync(packDir);
  const tgz = entries.find((f) => f.startsWith('hono-preact-') && f.endsWith('.tgz'));
  if (!tgz) throw new Error('failed to locate packed hono-preact tarball');
  tarballPath = join(packDir, tgz);
}, 180_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function scaffold(name: string, adapter: 'cloudflare' | 'node'): Promise<string> {
  const code = await run({
    argv: [name, `--adapter=${adapter}`, '--no-install', '--no-git'],
    cwd: workDir,
    env: {},
  });
  if (code !== 0) throw new Error(`scaffold failed with code ${code}`);

  const target = join(workDir, name);

  // Point hono-preact at the local tarball so we don't depend on the registry.
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies['hono-preact'] = `file:${tarballPath}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  return target;
}

describe('scaffold + install + build — node adapter', () => {
  it('produces a buildable Node app', async () => {
    const target = await scaffold('integration-node', 'node');

    execFileSync('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
      cwd: target,
      stdio: 'inherit',
    });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'server', 'server-entry.js'))).toBe(true);
  }, 180_000);
});

describe('scaffold + install + build — cloudflare adapter', () => {
  it('produces a buildable Cloudflare app', async () => {
    const target = await scaffold('integration-cf', 'cloudflare');

    execFileSync('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
      cwd: target,
      stdio: 'inherit',
    });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    // Worker output dir: name with hyphens -> underscores ("integration-cf" -> "integration_cf").
    expect(existsSync(join(target, 'dist', 'integration_cf'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'integration_cf', 'index.js'))).toBe(true);
  }, 180_000);
});
