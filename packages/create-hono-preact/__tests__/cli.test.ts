import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain JS module
import { run } from '../lib/cli.mjs';

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-cli-test-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('run() — node adapter', () => {
  it('scaffolds a new node app with --no-install --no-git', async () => {
    const code = await run({
      argv: ['my-test-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);

    const target = join(workDir, 'my-test-app');
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(existsSync(join(target, '_gitignore'))).toBe(false);
    expect(existsSync(join(target, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'api.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'Layout.tsx'))).toBe(true);
    expect(existsSync(join(target, 'src', 'routes.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.tsx'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.server.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'about.tsx'))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-test-app');

    const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
    expect(layout).toContain('{{name}}');
  });
});

describe('run() — cloudflare adapter', () => {
  it('scaffolds a new cloudflare app, including wrangler.jsonc', async () => {
    const code = await run({
      argv: ['my-cf-app', '--adapter=cloudflare', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);

    const target = join(workDir, 'my-cf-app');
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(true);
    const wrangler = readFileSync(join(target, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "my-cf-app"');
  });

  it('cloudflare is the default adapter', async () => {
    await run({
      argv: ['default-cf', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(existsSync(join(workDir, 'default-cf', 'wrangler.jsonc'))).toBe(true);
  });
});

describe('run() — target dir validation', () => {
  it('refuses a non-empty existing target dir', async () => {
    const target = join(workDir, 'existing');
    const fs = await import('node:fs/promises');
    await fs.mkdir(target);
    await fs.writeFile(join(target, 'README.md'), 'hi');

    const code = await run({
      argv: ['existing', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(1);
  });

  it('accepts an empty existing target dir', async () => {
    const target = join(workDir, 'empty-existing');
    const fs = await import('node:fs/promises');
    await fs.mkdir(target);

    const code = await run({
      argv: ['empty-existing', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
  });
});
