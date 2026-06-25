import { describe, it, expect } from 'vitest';
import { parseArgs, recoverNpmStrippedFlags } from '../lib/args.mjs';

describe('parseArgs', () => {
  it('parses a positional target dir', () => {
    expect(parseArgs(['my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('defaults adapter to cloudflare', () => {
    expect(parseArgs(['my-app']).adapter).toBe('cloudflare');
  });

  it('accepts --adapter=node', () => {
    expect(parseArgs(['my-app', '--adapter=node']).adapter).toBe('node');
  });

  it('accepts --adapter=cloudflare', () => {
    expect(parseArgs(['my-app', '--adapter=cloudflare']).adapter).toBe(
      'cloudflare'
    );
  });

  it('rejects an unknown adapter', () => {
    const result = parseArgs(['my-app', '--adapter=deno']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown adapter.*deno/i);
    }
  });

  it('--no-install flips install to false', () => {
    expect(parseArgs(['my-app', '--no-install']).install).toBe(false);
  });

  it('--no-git flips git to false', () => {
    expect(parseArgs(['my-app', '--no-git']).git).toBe(false);
  });

  it('returns kind=help for --help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns kind=help for -h', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('returns kind=version for --version', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('returns kind=scaffold with no targetDir when none given', () => {
    expect(parseArgs([])).toEqual({
      kind: 'scaffold',
      targetDir: undefined,
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('flags can appear before the target dir', () => {
    expect(parseArgs(['--adapter=node', '--no-install', 'my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'node',
      install: false,
      git: true,
    });
  });

  it('rejects unknown flags with kind=error', () => {
    const result = parseArgs(['my-app', '--unknown']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown flag.*--unknown/i);
    }
  });

  it('rejects multiple positional args', () => {
    const result = parseArgs(['my-app', 'extra']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unexpected/i);
    }
  });
});

describe('parseArgs — add-agents', () => {
  it('parses add-agents with no flags', () => {
    expect(parseArgs(['add-agents'])).toEqual({
      kind: 'add-agents',
      force: false,
    });
  });
  it('parses add-agents --force', () => {
    expect(parseArgs(['add-agents', '--force'])).toEqual({
      kind: 'add-agents',
      force: true,
    });
  });
  it('rejects an unknown add-agents flag', () => {
    expect(parseArgs(['add-agents', '--bogus'])).toEqual({
      kind: 'error',
      message: 'unknown flag: --bogus',
    });
  });
});

describe('recoverNpmStrippedFlags', () => {
  it('recovers --adapter from npm_config_adapter when argv lacks it', () => {
    expect(
      recoverNpmStrippedFlags(['my-app'], { npm_config_adapter: 'node' })
    ).toEqual(['--adapter=node']);
  });

  it('lets an explicit --adapter in argv win (recovers nothing)', () => {
    expect(
      recoverNpmStrippedFlags(['my-app', '--adapter=cloudflare'], {
        npm_config_adapter: 'node',
      })
    ).toEqual([]);
  });

  it('recovers --no-install from the empty-string npm_config_install sentinel', () => {
    expect(
      recoverNpmStrippedFlags(['my-app'], { npm_config_install: '' })
    ).toEqual(['--no-install']);
  });

  it('recovers --no-git only for the literal "false" npm_config_git sentinel', () => {
    expect(
      recoverNpmStrippedFlags(['my-app'], { npm_config_git: 'false' })
    ).toEqual(['--no-git']);
  });

  it('does not treat a real npm_config_git binary path as --no-git', () => {
    // npm's `git` config is the git binary path (default "git"); only the
    // `--no-git` negation produces the literal string "false".
    expect(
      recoverNpmStrippedFlags(['my-app'], { npm_config_git: '/usr/bin/git' })
    ).toEqual([]);
  });

  it('ignores an unset npm_config_install (only "" means --no-install)', () => {
    expect(recoverNpmStrippedFlags(['my-app'], {})).toEqual([]);
  });

  it('recovers several stripped flags at once, in flag order', () => {
    expect(
      recoverNpmStrippedFlags(['my-app'], {
        npm_config_adapter: 'node',
        npm_config_install: '',
        npm_config_git: 'false',
      })
    ).toEqual(['--adapter=node', '--no-install', '--no-git']);
  });

  it('recovers nothing for the add-agents subcommand', () => {
    expect(
      recoverNpmStrippedFlags(['add-agents'], { npm_config_adapter: 'node' })
    ).toEqual([]);
  });

  it('recovers nothing when no npm_config_* flags are present (pnpm/bun path)', () => {
    expect(
      recoverNpmStrippedFlags(['my-app'], {
        npm_config_user_agent: 'pnpm/10',
      })
    ).toEqual([]);
  });
});
