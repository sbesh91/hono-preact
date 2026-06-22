import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(existsSync(join(target, 'src', 'pages', 'home.server.ts'))).toBe(
      true
    );
    expect(existsSync(join(target, 'src', 'pages', 'about.tsx'))).toBe(true);
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-page.md'))).toBe(
      true
    );
    expect(
      existsSync(join(target, 'agents', 'skills', 'add-a-loader.md'))
    ).toBe(true);
    expect(
      existsSync(join(target, 'agents', 'skills', 'add-an-action.md'))
    ).toBe(true);
    expect(existsSync(join(target, 'agents', 'skills', 'add-a-guard.md'))).toBe(
      true
    );
    expect(existsSync(join(target, 'agents', 'llms-full.txt'))).toBe(true);
    // recipes are NOT dumped at the project root
    expect(existsSync(join(target, 'skills'))).toBe(false);

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
    expect(existsSync(join(workDir, 'default-cf', 'wrangler.jsonc'))).toBe(
      true
    );
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
      env: {
        npm_config_user_agent: 'pnpm/10.18.3 npm/? node/v20 darwin arm64',
      },
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
      return {
        on: (_e: string, cb: (c: number) => void) =>
          queueMicrotask(() => cb(0)),
      };
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

  it('warns but does not abort when git is missing from PATH (error event)', async () => {
    const fakeSpawn = (cmd: string) => {
      if (cmd === 'git') {
        return {
          on: (e: string, cb: (arg: unknown) => void) => {
            if (e === 'error') queueMicrotask(() => cb(new Error('ENOENT')));
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
      argv: ['git-missing-app', '--adapter=node', '--no-install'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(0);
  });

  it('returns non-zero when install binary is missing from PATH', async () => {
    const fakeSpawn = (cmd: string) => {
      if (cmd === 'pnpm') {
        return {
          on: (e: string, cb: (arg: unknown) => void) => {
            if (e === 'error') queueMicrotask(() => cb(new Error('ENOENT')));
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
      argv: ['pm-missing-app', '--adapter=node', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'pnpm/10' },
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(1);
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

describe('run() — prompt for target dir', () => {
  it('prompts when target dir is missing and uses the answer', async () => {
    const calls: string[] = [];
    const fakeSpawn = () => ({
      on: (e: string, cb: (c: number) => void) => {
        if (e === 'close') queueMicrotask(() => cb(0));
      },
    });
    const fakePrompt = async (msg: string) => {
      calls.push(msg);
      return 'prompted-app';
    };

    const code = await run({
      argv: ['--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
      prompt: fakePrompt,
    });

    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0].toLowerCase()).toContain('project');
    expect(existsSync(join(workDir, 'prompted-app', 'package.json'))).toBe(
      true
    );
  });

  it('returns 1 when the user provides an empty answer', async () => {
    const fakePrompt = async () => '';
    const code = await run({
      argv: ['--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      prompt: fakePrompt,
    });
    expect(code).toBe(1);
  });
});

describe('run() — help and version', () => {
  it('--help returns 0 and prints usage', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const code = await run({ argv: ['--help'], cwd: workDir, env: {} });
      expect(code).toBe(0);
      expect(lines.join('\n').toLowerCase()).toContain('usage');
    } finally {
      console.log = originalLog;
    }
  });

  it('--version returns 0 and prints the version', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const code = await run({ argv: ['--version'], cwd: workDir, env: {} });
      expect(code).toBe(0);
      const { version } = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8')
      );
      expect(lines.join(' ')).toBe(`create-hono-preact ${version}`);
    } finally {
      console.log = originalLog;
    }
  });

  it('unknown flag returns 2', async () => {
    const code = await run({ argv: ['--bogus'], cwd: workDir, env: {} });
    expect(code).toBe(2);
  });
});

describe('run() — next-steps output', () => {
  it('prints next steps after a successful scaffold', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const fakeSpawn = () => ({
        on: (e: string, cb: (c: number) => void) => {
          if (e === 'close') queueMicrotask(() => cb(0));
        },
      });
      await run({
        argv: ['next-app', '--adapter=node', '--no-install', '--no-git'],
        cwd: workDir,
        env: { npm_config_user_agent: 'pnpm/10' },
        spawnFn: fakeSpawn,
      });
      const out = lines.join('\n');
      expect(out).toMatch(/next steps/i);
      expect(out).toContain('cd next-app');
      expect(out).toMatch(/pnpm/);
      expect(out).toContain('dev');
    } finally {
      console.log = originalLog;
    }
  });
});

describe('run() — add-agents', () => {
  it('writes AGENTS.md and CLAUDE.md into the cwd', async () => {
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0);
    expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
  });

  it('writes the recipes and corpus under agents/', async () => {
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0);
    expect(existsSync(join(workDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(workDir, 'agents', 'skills', 'add-a-page.md'))).toBe(
      true
    );
    expect(existsSync(join(workDir, 'agents', 'llms-full.txt'))).toBe(true);
  });

  it('does not overwrite an existing AGENTS.md without --force', async () => {
    writeFileSync(join(workDir, 'AGENTS.md'), 'KEEP');
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(0); // CLAUDE.md still created, so not all skipped
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).toBe('KEEP');
    expect(existsSync(join(workDir, 'CLAUDE.md'))).toBe(true);
  });

  it('returns 1 when every target is skipped', async () => {
    // First run populates all files; second run with no --force skips all.
    await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    const code = await run({ argv: ['add-agents'], cwd: workDir, env: {} });
    expect(code).toBe(1);
  });

  it('overwrites with --force', async () => {
    writeFileSync(join(workDir, 'AGENTS.md'), 'OLD');
    const code = await run({
      argv: ['add-agents', '--force'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);
    expect(readFileSync(join(workDir, 'AGENTS.md'), 'utf8')).not.toBe('OLD');
  });
});
