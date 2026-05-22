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

describe('run() — install step', () => {
  it('invokes the detected package manager when install is enabled', async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const fakeSpawn = (cmd: string, args: string[], opts: { cwd: string }) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return {
        on(event: string, cb: (code: number) => void) {
          if (event === 'close') queueMicrotask(() => cb(0));
        },
      };
    };

    const code = await run({
      argv: ['installed-app', '--adapter=node', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'pnpm/10.18.3 npm/? node/v20 darwin arm64' },
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('pnpm');
    expect(calls[0].args).toEqual(['install']);
    expect(calls[0].cwd).toBe(join(workDir, 'installed-app'));
  });

  it('skips install when --no-install is set', async () => {
    const calls: Array<{ cmd: string }> = [];
    const fakeSpawn = (cmd: string) => {
      calls.push({ cmd });
      return { on: (_e: string, cb: (c: number) => void) => queueMicrotask(() => cb(0)) };
    };

    await run({
      argv: ['skipped-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'npm/10.2.5' },
      spawnFn: fakeSpawn,
    });

    expect(calls.length).toBe(0);
  });

  it('returns 1 when install fails', async () => {
    const fakeSpawn = () => ({
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') queueMicrotask(() => cb(1));
      },
    });

    const code = await run({
      argv: ['fail-install', '--adapter=node', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'pnpm/10' },
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(1);
  });
});

describe('run() — git step', () => {
  it('invokes git init when git is enabled', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const fakeSpawn = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return {
        on: (e: string, cb: (c: number) => void) => {
          if (e === 'close') queueMicrotask(() => cb(0));
        },
      };
    };

    await run({
      argv: ['git-app', '--adapter=node', '--no-install'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    const gitCall = calls.find((c) => c.cmd === 'git');
    expect(gitCall).toBeTruthy();
    expect(gitCall?.args).toEqual(['init']);
  });

  it('skips git init when --no-git is set', async () => {
    const calls: Array<{ cmd: string }> = [];
    const fakeSpawn = (cmd: string) => {
      calls.push({ cmd });
      return {
        on: (e: string, cb: (c: number) => void) => {
          if (e === 'close') queueMicrotask(() => cb(0));
        },
      };
    };

    await run({
      argv: ['no-git-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    expect(calls.find((c) => c.cmd === 'git')).toBeUndefined();
  });

  it('warns but does not abort when git init fails (git may be absent)', async () => {
    const fakeSpawn = (cmd: string) => {
      if (cmd === 'git') {
        return {
          on: (e: string, cb: (c: number) => void) => {
            if (e === 'close') queueMicrotask(() => cb(1));
          },
        };
      }
      return {
        on: (e: string, cb: (c: number) => void) => {
          if (e === 'close') queueMicrotask(() => cb(0));
        },
      };
    };

    const code = await run({
      argv: ['git-fail-app', '--adapter=node', '--no-install'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(0);
  });
});
